import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';

/**
 * Server-side trigger for the courier proxy.
 *
 * The Edge Function is the only thing that ever holds a courier API key, and
 * it is invoked with the service-role key from server code — never from a
 * browser. Nothing about the provider crosses back to the caller: this
 * returns only whether dispatch was accepted.
 */

export type DispatchTriggerResult =
  | { dispatched: true }
  | { dispatched: false; reason: string };

/**
 * Which courier, if any, this tenant is set up with.
 *
 * Uber Direct wins when both are present. The two integrations dispatch at
 * different moments — Shipday when payment lands, Uber when the kitchen
 * starts cooking — so a tenant configured for both would have booked two
 * couriers for one order. The Uber route's own idempotency check happens
 * to catch it, but only because Shipday runs first; relying on that
 * ordering is not a design.
 */
async function configuredProvider(tenantId: string): Promise<'uber_direct' | 'shipday' | null> {
  const service = createServiceClient();
  const { data } = await service
    .from('tenant_secrets')
    .select('key')
    .eq('tenant_id', tenantId)
    .in('key', ['uber_customer_id', 'shipday_api_key']);

  const keys = new Set((data ?? []).map((row) => row.key));
  if (keys.has('uber_customer_id')) return 'uber_direct';
  if (keys.has('shipday_api_key')) return 'shipday';
  return null;
}

/**
 * Dispatch at payment time.
 *
 * This is the Shipday path and is retained but no longer the default: a
 * tenant on Uber Direct is dispatched from the KDS instead, when the food
 * actually starts being made, which is a better moment to have a courier
 * arrive.
 */
export async function triggerDispatch(orderId: string): Promise<DispatchTriggerResult> {
  const service = createServiceClient();

  const { data: order } = await service
    .from('orders')
    .select('tenant_id')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { dispatched: false, reason: 'Order not found' };

  const provider = await configuredProvider(order.tenant_id);

  if (provider === 'uber_direct') {
    // Not a failure, and deliberately not recorded as one: the KDS will
    // dispatch this order when it starts being prepared.
    return { dispatched: false, reason: 'Handled by Uber Direct at preparation time' };
  }

  if (provider === null) {
    return { dispatched: false, reason: 'No courier configured for this restaurant' };
  }

  try {
    const { data, error } = await service.functions.invoke<{ ok: boolean; error?: string }>(
      'shipday-dispatch',
      { body: { orderId } },
    );

    if (error) {
      await recordDispatchFailure(orderId, error.message);
      return { dispatched: false, reason: error.message };
    }
    if (!data?.ok) {
      const reason = data?.error ?? 'Courier dispatch was not accepted';
      await recordDispatchFailure(orderId, reason);
      return { dispatched: false, reason };
    }

    return { dispatched: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Courier dispatch failed';
    await recordDispatchFailure(orderId, reason);
    return { dispatched: false, reason };
  }
}

/**
 * A failed dispatch must not fail the payment webhook — the order is paid
 * and the kitchen still needs it. The delivery row stays `unassigned` with
 * the reason recorded, which is both visible to staff and requeueable.
 */
async function recordDispatchFailure(orderId: string, reason: string): Promise<void> {
  const service = createServiceClient();
  await service
    .from('deliveries')
    .update({ status: 'unassigned', failure_reason: reason.slice(0, 500) })
    .eq('order_id', orderId);
}
