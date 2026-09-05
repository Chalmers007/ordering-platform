import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';

/**
 * Dispatch health and metrics.
 *
 * For admin dashboard and monitoring.
 */

export interface DispatchMetrics {
  // Last 24 hours
  attempted: number;
  succeeded: number;
  failed: number;
  successRate: number; // 0-100

  // Status breakdown
  unassigned: number;
  assigned: number;
  pickedUp: number;
  enRoute: number;
  delivered: number;
  cancelled: number;
  failedCount: number;

  // Timing
  avgDispatchTimeMs: number;
  avgDeliveryTimeMs: number;

  // Retry queue
  awaitingRetry: number;
  retryExhausted: number;
}

/**
 * Get dispatch metrics for a tenant.
 */
export async function getDispatchMetrics(tenantId: string): Promise<DispatchMetrics> {
  const service = createServiceClient();
  const day24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [eventStats, deliveryStats, retryStats] = await Promise.all([
    // Event counts from last 24h
    service
      .from('dispatch_events')
      .select('event_type')
      .eq('tenant_id', tenantId)
      .gte('created_at', day24hAgo),

    // Current delivery status breakdown
    service
      .from('deliveries')
      .select('status')
      .eq('tenant_id', tenantId),

    // Retry queue
    service
      .from('deliveries')
      .select('attempts')
      .eq('tenant_id', tenantId)
      .eq('status', 'unassigned')
      .lte('next_retry_at', new Date().toISOString()),
  ]);

  const events = eventStats.data ?? [];
  const deliveries = deliveryStats.data ?? [];
  const retries = retryStats.data ?? [];

  const eventCounts = {
    succeeded: events.filter((e) => e.event_type === 'dispatch_succeeded').length,
    failed: events.filter((e) => e.event_type === 'dispatch_failed').length,
  };

  const attempted = eventCounts.succeeded + eventCounts.failed;
  const successRate = attempted > 0 ? (eventCounts.succeeded / attempted) * 100 : 0;

  const statuses = deliveries.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    attempted,
    succeeded: eventCounts.succeeded,
    failed: eventCounts.failed,
    successRate: Math.round(successRate),

    unassigned: statuses.unassigned ?? 0,
    assigned: statuses.assigned ?? 0,
    pickedUp: statuses.picked_up ?? 0,
    enRoute: statuses.en_route ?? 0,
    delivered: statuses.delivered ?? 0,
    cancelled: statuses.cancelled ?? 0,
    failedCount: statuses.failed ?? 0,

    avgDispatchTimeMs: 0, // TODO: calculate from events
    avgDeliveryTimeMs: 0, // TODO: calculate from delivery lifecycle

    awaitingRetry: retries.length,
    retryExhausted: deliveries.filter((d) => d.attempts >= 5).length,
  };
}

/**
 * Log a dispatch event.
 */
export async function logDispatchEvent(
  tenantId: string,
  orderId: string,
  deliveryId: string,
  eventType: string,
  details?: {
    status?: string;
    externalRef?: string;
    provider?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const service = createServiceClient();

  await service.from('dispatch_events').insert({
    tenant_id: tenantId,
    order_id: orderId,
    delivery_id: deliveryId,
    event_type: eventType,
    status: details?.status,
    external_ref: details?.externalRef,
    provider: details?.provider,
    error_message: details?.errorMessage,
    metadata: details?.metadata,
  });
}
