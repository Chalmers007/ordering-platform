import type { NextRequest } from 'next/server';

/** Demo-only unpaid order gate. `nodeEnv` is injectable for tests. */
export function isLocalUnpaidRequest(
  request: NextRequest,
  requested: boolean,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  if (!requested || nodeEnv === 'production') return false;
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}
