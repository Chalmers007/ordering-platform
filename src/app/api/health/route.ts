import { NextResponse } from 'next/server';
import { createClientForRequest } from '@/lib/supabase/server';

/**
 * Liveness and dependency check, for uptime monitoring and the
 * post-deploy smoke test.
 *
 * Deliberately shallow: it proves the app is serving and that Postgres is
 * reachable, and nothing else. It touches `reserved_subdomains` — a tiny,
 * anon-readable, tenant-independent table — through the ordinary RLS
 * client, so a health probe can never become a way to read tenant data or
 * a hole that bypasses the service-role boundary.
 *
 * Nothing here reveals versions, connection strings, or row counts that
 * would help someone map the deployment.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();

  let databaseUp = false;
  try {
    const supabase = await createClientForRequest();
    const { error } = await supabase
      .from('reserved_subdomains')
      .select('slug', { count: 'exact', head: true })
      .limit(1);
    databaseUp = !error;
  } catch {
    databaseUp = false;
  }

  const body = {
    ok: databaseUp,
    database: databaseUp ? 'up' : 'down',
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  // 503 when a dependency is down, so an uptime monitor treats it as an
  // outage rather than a healthy response that happens to say "down".
  return NextResponse.json(body, {
    status: databaseUp ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
