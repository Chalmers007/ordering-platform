'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  isBluetoothAvailable,
  pairBluetoothPrinter,
  printJob,
  savePrinterConfig,
} from '@/lib/hardware/printer';
import { renderTicket } from '@/lib/hardware/ticket';
import type { OrderWithDetails, PrinterConfig, PrinterTransport } from '@/types/database';

const TRANSPORTS: { id: PrinterTransport; label: string; hint: string }[] = [
  {
    id: 'bluetooth',
    label: 'Bluetooth',
    hint: 'Pairs this tablet directly with the printer. Needs HTTPS and a Chromium browser.',
  },
  {
    id: 'network',
    label: 'Network (this server)',
    hint: 'The server opens a socket to the printer on port 9100. Only works when the app is hosted on the same network as the kitchen.',
  },
  {
    id: 'websocket',
    label: 'Print bridge',
    hint: 'A small agent on the kitchen network holds the printer connection. Use this when the app is hosted in the cloud.',
  },
  {
    id: 'browser-print',
    label: 'Browser print dialog',
    hint: 'No thermal printer. Opens the normal print dialog with the ticket as text.',
  },
];

export function PrinterSettings({
  tenantId,
  config,
  onConfigChange,
  sampleOrder,
  restaurantName,
}: {
  tenantId: string;
  config: PrinterConfig;
  onConfigChange: (config: PrinterConfig) => void;
  sampleOrder: OrderWithDetails | null;
  restaurantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function update(patch: Partial<PrinterConfig>) {
    const next = { ...config, ...patch };
    onConfigChange(next);
    savePrinterConfig(tenantId, next);
  }

  async function pair() {
    setBusy(true);
    const result = await pairBluetoothPrinter(config);
    setBusy(false);
    if (result.ok) toast.success('Printer paired');
    else toast.error(result.error);
  }

  async function testPrint() {
    if (!sampleOrder) {
      toast.error('Send a test print once there is an order on the board.');
      return;
    }
    setBusy(true);
    const job = renderTicket(sampleOrder, {
      restaurantName,
      columns: config.columns,
      variant: 'kitchen',
    });
    const result = await printJob(job, config);
    setBusy(false);
    if (result.ok) toast.success('Test ticket sent');
    else toast.error(result.error);
  }

  const selected = TRANSPORTS.find((t) => t.id === config.transport);
  const needsAddress = config.transport === 'network' || config.transport === 'websocket';

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 text-neutral-100 hover:bg-neutral-700"
        aria-label="Printer settings"
        onClick={() => setOpen(true)}
      >
        <Printer className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <div className="overflow-y-auto px-5 pb-5 pt-6">
            <DialogTitle className="pr-8 text-lg font-semibold">Printer</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-neutral-600">
              These settings belong to this device. Two tablets in one kitchen can drive
              different printers.
            </DialogDescription>

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">Connection</legend>
              <div className="mt-2 space-y-1">
                {TRANSPORTS.map((transport) => (
                  <label
                    key={transport.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                      config.transport === transport.id
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="transport"
                      className="mt-0.5 h-4 w-4"
                      checked={config.transport === transport.id}
                      onChange={() => update({ transport: transport.id })}
                    />
                    <span>
                      <span className="font-medium">{transport.label}</span>
                      <span className="mt-0.5 block text-xs text-neutral-600">
                        {transport.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {config.transport === 'bluetooth' ? (
              <div className="mt-4">
                <Button variant="outline" loading={busy} onClick={pair} disabled={!isBluetoothAvailable()}>
                  Pair a printer
                </Button>
                {!isBluetoothAvailable() ? (
                  <p className="mt-2 text-xs text-red-600">
                    This browser does not support Web Bluetooth. Chrome or Edge on Android,
                    Windows, or macOS does.
                  </p>
                ) : null}
              </div>
            ) : null}

            {needsAddress ? (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Input
                  className="col-span-2"
                  aria-label="Printer address"
                  placeholder={config.transport === 'websocket' ? 'ws://192.168.1.50:9101' : '192.168.1.50'}
                  value={config.host ?? ''}
                  onChange={(event) => update({ host: event.target.value })}
                />
                <Input
                  aria-label="Port"
                  inputMode="numeric"
                  placeholder={config.transport === 'websocket' ? '9101' : '9100'}
                  value={config.port ?? ''}
                  onChange={(event) =>
                    update({ port: Number(event.target.value) || undefined })
                  }
                />
              </div>
            ) : null}

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">Paper width</legend>
              <div className="mt-2 flex gap-2">
                {([32, 48] as const).map((columns) => (
                  <button
                    key={columns}
                    onClick={() => update({ columns })}
                    aria-pressed={config.columns === columns}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      config.columns === columns
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300'
                    }`}
                  >
                    {columns === 32 ? '58 mm' : '80 mm'}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={config.autoPrintOnCreate}
                onChange={(event) => update({ autoPrintOnCreate: event.target.checked })}
              />
              <span>
                <span className="font-medium">Print automatically</span>
                <span className="mt-0.5 block text-xs text-neutral-600">
                  Send a ticket to the printer the moment an order arrives.
                </span>
              </span>
            </label>

            <div className="mt-3 flex items-center gap-3">
              <label className="text-sm">
                Copies
                <Input
                  className="mt-1 w-20"
                  inputMode="numeric"
                  value={config.copies}
                  onChange={(event) =>
                    update({ copies: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })
                  }
                />
              </label>
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" loading={busy} onClick={testPrint}>
                Test print
              </Button>
              <Button className="flex-1" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>

            <p className="mt-3 text-xs text-neutral-500">{selected?.hint}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
