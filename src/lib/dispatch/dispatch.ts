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

export async function triggerDispatch(orderId: string): Promise<DispatchTriggerResult> {
  const service = createServiceClient();

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
