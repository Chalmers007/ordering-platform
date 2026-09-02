'use client';

import type { PrinterConfig, PrintJob, PrinterTransport } from '@/types/database';

/**
 * Printer transports.
 *
 * A browser cannot open a raw TCP socket, so "network printing" is not a
 * browser driver — it is a server that can reach the printer:
 *
 *   bluetooth  Web Bluetooth, straight from the tablet to the printer.
 *              Requires a user gesture and HTTPS. The only fully in-browser
 *              path, and the right one for a counter tablet.
 *   network    POST to /api/print/network, which opens a TCP socket to the
 *              printer on port 9100. This only works when the server shares
 *              a network with the printer — a self-hosted or on-prem
 *              deployment. From Vercel it cannot reach a kitchen LAN, and
 *              the route says so rather than timing out mysteriously.
 *   websocket  A small bridge agent on the kitchen LAN holds the socket and
 *              the browser sends it bytes. This is the path that works with
 *              a cloud deployment.
 *   browser    window.print() of the text rendering. The fallback for a
 *              venue with no thermal printer at all.
 */

const STORAGE_KEY = 'op.printer.';

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  transport: 'browser-print',
  columns: 48,
  copies: 1,
  autoPrintOnCreate: false,
};

/**
 * Printer settings are per DEVICE, not per tenant: two tablets in the same
 * kitchen legitimately drive different printers, so this belongs in local
 * storage rather than in `tenant_settings`.
 */
export function loadPrinterConfig(tenantId: string): PrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_PRINTER_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY + tenantId);
    if (!raw) return DEFAULT_PRINTER_CONFIG;
    return { ...DEFAULT_PRINTER_CONFIG, ...(JSON.parse(raw) as Partial<PrinterConfig>) };
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

export function savePrinterConfig(tenantId: string, config: PrinterConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY + tenantId, JSON.stringify(config));
  } catch {
    // Storage unavailable; the config lives for this session only.
  }
}

export type PrintResult = { ok: true } | { ok: false; error: string };

// --- Web Bluetooth ----------------------------------------------------

/** The de-facto serial-over-GATT service most thermal printers expose. */
const DEFAULT_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const DEFAULT_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

/** GATT writes are capped near the MTU; 512 is the safe ceiling and 180 is
 *  what cheap printers actually tolerate without dropping bytes. */
const BLUETOOTH_CHUNK = 180;

type BluetoothCharacteristic = {
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValue: (value: BufferSource) => Promise<void>;
};

let cachedCharacteristic: BluetoothCharacteristic | null = null;

export function isBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Must be called from a user gesture — the browser will not show the device
 * chooser otherwise. The KDS pairs once from settings and reuses the handle.
 */
export async function pairBluetoothPrinter(config: PrinterConfig): Promise<PrintResult> {
  if (!isBluetoothAvailable()) {
    return { ok: false, error: 'This browser does not support Web Bluetooth.' };
  }

  const serviceUuid = config.serviceUuid ?? DEFAULT_SERVICE_UUID;
  const characteristicUuid = config.characteristicUuid ?? DEFAULT_CHARACTERISTIC_UUID;

  try {
    const nav = navigator as unknown as {
      bluetooth: {
        requestDevice: (options: unknown) => Promise<{
          gatt?: {
            connect: () => Promise<{
              getPrimaryService: (uuid: string) => Promise<{
                getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristic>;
              }>;
            }>;
          };
        }>;
      };
    };

    const device = await nav.bluetooth.requestDevice({
      filters: [{ services: [serviceUuid] }],
      optionalServices: [serviceUuid],
    });

    const server = await device.gatt?.connect();
    if (!server) return { ok: false, error: 'Could not connect to the printer.' };

    const service = await server.getPrimaryService(serviceUuid);
    cachedCharacteristic = await service.getCharacteristic(characteristicUuid);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Pairing was cancelled.',
    };
  }
}

async function printOverBluetooth(job: PrintJob): Promise<PrintResult> {
  if (!cachedCharacteristic) {
    return { ok: false, error: 'No printer paired. Pair one in printer settings first.' };
  }

  try {
    for (let offset = 0; offset < job.bytes.length; offset += BLUETOOTH_CHUNK) {
      const chunk = job.bytes.slice(offset, offset + BLUETOOTH_CHUNK);
      if (cachedCharacteristic.writeValueWithoutResponse) {
        await cachedCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await cachedCharacteristic.writeValue(chunk);
      }
    }
    return { ok: true };
  } catch (error) {
    cachedCharacteristic = null; // Force a re-pair on the next attempt.
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The printer stopped responding.',
    };
  }
}

// --- Network (via the server) -----------------------------------------

/** Bytes go as base64 because JSON has no binary type and a number[] of a
 *  10KB ticket is an order of magnitude larger on the wire. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function printOverNetwork(job: PrintJob, config: PrinterConfig): Promise<PrintResult> {
  if (!config.host) {
    return { ok: false, error: 'No printer address configured.' };
  }

  try {
    const response = await fetch('/api/print/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: config.host,
        port: config.port ?? 9100,
        data: bytesToBase64(job.bytes),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? 'The printer did not accept the job.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the print service.' };
  }
}

// --- WebSocket bridge -------------------------------------------------

async function printOverWebSocket(job: PrintJob, config: PrinterConfig): Promise<PrintResult> {
  if (!config.host) {
    return { ok: false, error: 'No print bridge address configured.' };
  }

  const url = config.host.startsWith('ws') ? config.host : `ws://${config.host}:${config.port ?? 9101}`;

  return new Promise<PrintResult>((resolve) => {
    let settled = false;
    const finish = (result: PrintResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      finish({ ok: false, error: 'The print bridge address is not valid.' });
      return;
    }

    socket.binaryType = 'arraybuffer';
    const timeout = window.setTimeout(() => {
      socket.close();
      finish({ ok: false, error: 'The print bridge did not respond.' });
    }, 5_000);

    socket.onopen = () => {
      // A copy: `job.bytes` may be a view onto a larger buffer, and send()
      // would transmit the whole thing.
      socket.send(job.bytes.slice().buffer as ArrayBuffer);
      window.clearTimeout(timeout);
      socket.close();
      finish({ ok: true });
    };

    socket.onerror = () => {
      window.clearTimeout(timeout);
      finish({ ok: false, error: 'Could not reach the print bridge.' });
    };
  });
}

// --- Browser fallback --------------------------------------------------

function printInBrowser(job: PrintJob): PrintResult {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '100%';
  frame.style.width = '0';
  frame.style.height = '0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return { ok: false, error: 'The browser blocked printing.' };
  }

  const pre = doc.createElement('pre');
  pre.style.font = '12px/1.35 ui-monospace, monospace';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = job.preview;
  doc.body.appendChild(pre);

  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 1_000);

  return { ok: true };
}

// --- entry point -------------------------------------------------------

export async function printJob(job: PrintJob, config: PrinterConfig): Promise<PrintResult> {
  const transports: Record<PrinterTransport, () => Promise<PrintResult> | PrintResult> = {
    bluetooth: () => printOverBluetooth(job),
    network: () => printOverNetwork(job, config),
    websocket: () => printOverWebSocket(job, config),
    'browser-print': () => printInBrowser(job),
  };

  const copies = Math.max(1, Math.min(config.copies, 5));
  let last: PrintResult = { ok: true };

  for (let i = 0; i < copies; i += 1) {
    last = await transports[config.transport]();
    if (!last.ok) return last;
  }
  return last;
}
