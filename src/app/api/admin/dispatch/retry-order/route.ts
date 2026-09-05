import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { autoDispatch } from '@/lib/dispatch/auto-dispatch';
import { logDispatchEvent } from '@/lib/dispatch/metrics';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { orderId } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get delivery
  const { data: delivery } = await (supabase as any)
    .from('deliveries')
    .select('id, order_id, attempts, tenant_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!delivery) {
    return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
  }

  // Check if exhausted
  if ((delivery.attempts || 0) >= 5) {
    return NextResponse.json(
      { error: 'Delivery has exhausted all retries' },
      { status: 400 },
    );
  }

  try {
    // Retry dispatch
    const result = await autoDispatch(orderId);

    if (result.dispatched) {
      await logDispatchEvent(
        delivery.tenant_id,
        orderId,
        delivery.id,
        'dispatch_succeeded',
        { provider: 'uber_direct', externalRef: result.externalRef },
      );
      return NextResponse.json({ success: true, message: 'Dispatch retried' });
    } else {
      // Schedule next retry
      const nextAttempt = (delivery.attempts || 0) + 1;
      const backoffs = [30, 300, 1800, 14400, 86400];
      const backoff = backoffs[Math.min(nextAttempt, backoffs.length - 1)];
      const nextRetry = new Date(Date.now() + backoff * 1000);

      await (supabase as any)
        .from('deliveries')
        .update({
          attempts: nextAttempt,
          next_retry_at: nextRetry.toISOString(),
          failure_reason: result.reason,
        })
        .eq('id', delivery.id);

      await logDispatchEvent(
        delivery.tenant_id,
        orderId,
        delivery.id,
        'dispatch_failed',
        { errorMessage: result.reason },
      );

      return NextResponse.json(
        { success: false, message: result.reason, nextRetryAt: nextRetry },
        { status: 400 },
      );
    }
  } catch (error) {
    await logDispatchEvent(
      delivery.tenant_id,
      orderId,
      delivery.id,
      'dispatch_failed',
      { errorMessage: error instanceof Error ? error.message : 'Unknown error' },
    );

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Retry failed' },
      { status: 500 },
    );
  }
}
