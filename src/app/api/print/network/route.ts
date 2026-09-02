import { Socket } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClientForRequest } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';

/**
 * Network printing.
 *
 * A browser cannot open a TCP socket, so the server does it. This only works
 * where the server can actually reach the printer — a self-hosted or on-prem
 * deployment sharing a LAN with the kitchen. On a cloud host there is no
 * route to a private address, and the check below says exactly that instead
 * of leaving the caller with a 30-second timeout.
 *
 * It is also an outbound-connection primitive, so it is locked down: staff
 * of a real tenant only, private address ranges only, one port.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(9100),
  /** base64 ESC/POS bytes */
  data: z.string().min(1).max(2_000_000),
});

const PRIVATE_IPV4 =
  /^(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/**
 * Server-Side Request Forgery guard.
 *
 * Without this, an authenticated staff user could point "the printer" at any
 * host the server can reach — cloud metadata endpoints included — and read
 * nothing back but still probe the internal network. A kitchen printer lives
 * on a private address or a `.local` name; nothing else is accepted.
 */
function isPrintableTarget(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (PRIVATE_IPV4.test(value)) return true;
  if (value === 'localhost') return true;
  if (/^[a-z0-9][a-z0-9-]{0,62}\.local$/.test(value)) return true;
  // A bare hostname with no dots: a LAN name from DHCP/NetBIOS.
  if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) return true;
  return false;
}

function sendToPrinter(host: string, port: number, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(5_000);
    socket.once('timeout', () => fail(new Error('The printer did not respond.')));
    socket.once('error', (error) => fail(error));

    socket.connect(port, host, () => {
      // Thermal printers are write-only: there is no acknowledgement to wait
      // for beyond the socket flushing.
      socket.end(payload, () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  });
}

export async function POST(request: NextRequest) {
  const tenant = await getTenantContext();
  if (!tenant) {
    return NextResponse.json({ error: 'No tenant for this request' }, { status: 404 });
  }

  const supabase = await createClientForRequest();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Membership is asked of the database, not inferred from the session.
  const { data: isMember } = await supabase.rpc('has_tenant_access', {
    p_tenant_id: tenant.tenantId,
  });
  if (!isMember) {
    return NextResponse.json({ error: 'Not permitted for this kitchen' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid print request' }, { status: 422 });
  }

  if (!isPrintableTarget(body.host)) {
    return NextResponse.json(
      {
        error:
          'Printer address must be on a local network. Public addresses are not allowed.',
      },
      { status: 400 },
    );
  }

  let payload: Buffer;
  try {
    payload = Buffer.from(body.data, 'base64');
  } catch {
    return NextResponse.json({ error: 'Print payload could not be decoded' }, { status: 422 });
  }

  try {
    await sendToPrinter(body.host, body.port, payload);
    return NextResponse.json({ ok: true, bytes: payload.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Printing failed.';
    const unreachable = /EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|did not respond/i.test(
      message,
    );
    return NextResponse.json(
      {
        error: unreachable
          ? 'Could not reach the printer. If this app is hosted in the cloud it cannot see your kitchen network — use the Bluetooth or bridge transport instead.'
          : message,
      },
      { status: 502 },
    );
  }
}
