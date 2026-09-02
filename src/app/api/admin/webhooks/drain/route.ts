import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { drainWebhookEvents } from '@/lib/webhooks/dispatch';

/**
 * Drains the outbound webhook outbox.
 *
 * Reachable two ways: by a platform administrator from the console, or by a
 * scheduler presenting CRON_SECRET. An outbox with no scheduled drain is a
 * queue that silently stops delivering, so this endpoint exists to be
 * called on a timer — see the README for wiring it to pg_cron or a Vercel
 * cron job.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    Boolean(cronSecret) &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`;

  if (!authorized) {
    const guard = await requireSuperAdmin();
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
        { status: guard.reason === 'unauthenticated' ? 401 : 403 },
      );
    }
  }

  const tenantId = request.nextUrl.searchParams.get('tenantId') ?? undefined;
  const result = await drainWebhookEvents(tenantId);
  return NextResponse.json(result);
}
