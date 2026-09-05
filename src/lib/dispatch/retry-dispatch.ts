import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { autoDispatch } from './auto-dispatch';

/**
 * Retry failed dispatch attempts.
 *
 * When autoDispatch fails (e.g., Uber API timeout, network error),
 * the delivery sits in 'unassigned' state. This function retries
 * those deliveries, backing off exponentially to avoid hammering Uber.
 *
 * Can be called by a scheduler (every minute) or manually via admin.
 */

export type RetryResult = {
  retried: number;
  succeeded: number;
  failed: number;
  errors: Array<{ orderId: string; reason: string }>;
};

/**
 * Calculate backoff seconds based on attempt count.
 * Exponential: 30s, 5m, 30m, 4h, 24h
 */
function backoffSeconds(attempts: number): number {
  const backoffs = [30, 300, 1800, 14400, 86400];
  return backoffs[Math.min(attempts, backoffs.length - 1)];
}

/**
 * Retry dispatch for unassigned deliveries that have been waiting long enough.
 */
export async function retryFailedDispatches(): Promise<RetryResult> {
  const service = createServiceClient();
  const result: RetryResult = {
    retried: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  // Find unassigned deliveries that haven't been retried recently
  const { data: deliveries, error } = await (service as any)
    .from('deliveries')
    .select('id, order_id, failure_reason, attempts')
    .eq('status', 'unassigned')
    .is('provider', null) // Not yet assigned to a provider
    .lte('next_retry_at', new Date().toISOString())
    .limit(25); // Batch size

  if (error || !deliveries?.length) {
    return result;
  }

  for (const delivery of deliveries) {
    try {
      const dispatchResult = await autoDispatch((delivery as any).order_id);

      if (dispatchResult.dispatched) {
        result.succeeded += 1;
      } else {
        result.failed += 1;
        result.errors.push({
          orderId: delivery.order_id,
          reason: dispatchResult.reason,
        });

        // Schedule next retry
        const nextAttempt = ((delivery as any).attempts || 0) + 1;
        const backoff = backoffSeconds(nextAttempt);
        const nextRetry = new Date(Date.now() + backoff * 1000);

        await (service as any)
          .from('deliveries')
          .update({
            attempts: nextAttempt,
            next_retry_at: nextRetry.toISOString(),
            failure_reason: dispatchResult.reason,
          })
          .eq('id', (delivery as any).id);
      }

      result.retried += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        orderId: delivery.order_id,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

/**
 * Check if a delivery has exhausted retries.
 */
export function isRetryExhausted(attempts: number): boolean {
  // Give up after 5 attempts (30s, 5m, 30m, 4h, 24h)
  return attempts >= 5;
}
