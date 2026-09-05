import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { cancelDelivery } from '@/lib/uber';

/**
 * Cancel a delivery when an order is cancelled.
 *
 * If an order has a pending Uber delivery, cancel it with a reason.
 * Uber will attempt to recall the driver; if already picked up, marks as failed.
 */

export type CancelDispatchResult = {
  cancelled: boolean;
  deliveryId: string;
  uberId?: string;
  reason?: string;
};

/**
 * Cancel the Uber delivery for an order.
 * Called when a customer cancels their order.
 */
export async function cancelOrderDispatch(orderId: string): Promise<CancelDispatchResult> {
  const service = createServiceClient();

  // Get the delivery
  const { data: delivery } = await service
    .from('deliveries')
    .select('id, external_ref, provider, status, order_id')
    .eq('order_id', orderId)
    .eq('provider', 'uber_direct')
    .maybeSingle();

  if (!delivery) {
    return {
      cancelled: false,
      deliveryId: orderId,
      reason: 'No Uber delivery found',
    };
  }

  // Can't cancel if already delivered
  if (delivery.status === 'delivered') {
    return {
      cancelled: false,
      deliveryId: delivery.id,
      uberId: delivery.external_ref || undefined,
      reason: 'Already delivered',
    };
  }

  // Can't cancel if already failed
  if (delivery.status === 'failed' || delivery.status === 'cancelled') {
    return {
      cancelled: false,
      deliveryId: delivery.id,
      uberId: delivery.external_ref || undefined,
      reason: `Already ${delivery.status}`,
    };
  }

  // Get tenant secret for cancellation
  const { data: order } = await service
    .from('orders')
    .select('tenant_id')
    .eq('id', orderId)
    .single();

  if (!order) {
    return {
      cancelled: false,
      deliveryId: delivery.id,
      reason: 'Order not found',
    };
  }

  const { data: secret } = await service
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', order.tenant_id)
    .eq('key', 'uber_customer_id')
    .maybeSingle();

  if (!secret?.value || !delivery.external_ref) {
    return {
      cancelled: false,
      deliveryId: delivery.id,
      reason: 'Cannot cancel: missing credentials',
    };
  }

  try {
    // Call Uber API to cancel
    await cancelDelivery(secret.value, delivery.external_ref);

    // Update delivery status
    await (service as any)
      .from('deliveries')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        failure_reason: 'Customer cancelled order',
      } as any)
      .eq('id', delivery.id);

    // Update order status if appropriate
    await service
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .in('status', ['confirmed', 'paid', 'preparing', 'ready', 'out_for_delivery']);

    return {
      cancelled: true,
      deliveryId: delivery.id,
      uberId: delivery.external_ref,
    };
  } catch (error) {
    console.error('[cancel-dispatch] Failed to cancel Uber delivery', orderId, error);
    return {
      cancelled: false,
      deliveryId: delivery.id,
      uberId: delivery.external_ref,
      reason: error instanceof Error ? error.message : 'Uber cancellation failed',
    };
  }
}
