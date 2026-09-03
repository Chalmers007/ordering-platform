import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import {
  UberDirectError,
  createDeliveryQuote,
  dispatchDelivery,
  mapUberStatus,
} from '@/lib/uber';

/**
 * Auto-dispatch after order creation.
 *
 * Intended to run immediately after an order is placed, before the customer
 * sees the confirmation. Gracefully handles missing credentials and logs
 * dispatch payloads when credentials are unavailable.
 */

export type AutoDispatchResult =
  | { dispatched: true; provider: string; externalRef: string }
  | { dispatched: false; reason: string };

/**
 * Determine the configured courier provider for a tenant.
 */
async function configuredProvider(
  tenantId: string,
): Promise<'uber_direct' | 'shipday' | null> {
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
 * Dispatch an order immediately after creation (Uber Direct path).
 *
 * This is the default auto-dispatch path: we dispatch as soon as the order
 * is placed, so the courier is en route while the kitchen starts preparing.
 * Idempotent: retries return the existing dispatch reference.
 */
async function autoDispatchUber(orderId: string): Promise<AutoDispatchResult> {
  const service = createServiceClient();

  const { data: order } = await service
    .from('orders')
    .select(
      `id, tenant_id, order_number, status, fulfillment_type, customer_name, customer_phone,
       delivery_address_line1, delivery_address_line2, delivery_city, delivery_region,
       delivery_postal_code, delivery_country, delivery_latitude, delivery_longitude,
       delivery_instructions, total_cents, promised_at,
       order_items ( name_snapshot, quantity )`,
    )
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { dispatched: false, reason: 'Order not found' };

  // Already dispatched.
  const { data: existing } = await service
    .from('deliveries')
    .select('external_ref, provider')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existing?.external_ref) {
    return { dispatched: true, provider: existing.provider ?? 'unknown', externalRef: existing.external_ref };
  }

  if (order.fulfillment_type !== 'delivery') {
    return { dispatched: false, reason: 'Pickup orders are not auto-dispatched' };
  }

  if (!order.delivery_address_line1 || !order.delivery_city || !order.delivery_postal_code) {
    return { dispatched: false, reason: 'Missing delivery address' };
  }

  const [{ data: secret }, { data: settings }, { data: tenant }] = await Promise.all([
    service
      .from('tenant_secrets')
      .select('value')
      .eq('tenant_id', order.tenant_id)
      .eq('key', 'uber_customer_id')
      .maybeSingle(),
    service
      .from('tenant_settings')
      .select('address_line1, address_line2, city, region, postal_code, country, latitude, longitude')
      .eq('tenant_id', order.tenant_id)
      .maybeSingle(),
    service.from('tenants').select('name, support_phone').eq('id', order.tenant_id).maybeSingle(),
  ]);

  if (!secret?.value) {
    return {
      dispatched: false,
      reason: 'Uber Direct customer ID not configured; set in tenant secrets',
    };
  }
  if (!settings?.address_line1 || !settings.city || !settings.postal_code) {
    return {
      dispatched: false,
      reason: 'Restaurant address incomplete; configure in Store Settings',
    };
  }
  if (!tenant?.support_phone) {
    return {
      dispatched: false,
      reason: 'Restaurant phone number missing; configure in Store Settings',
    };
  }

  const line = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');
  const pickupAddress = line(
    settings.address_line1,
    settings.address_line2,
    settings.city,
    settings.region,
    settings.postal_code,
  );
  const dropoffAddress = line(
    order.delivery_address_line1,
    order.delivery_address_line2,
    order.delivery_city,
    order.delivery_region,
    order.delivery_postal_code,
  );

  try {
    const quote = await createDeliveryQuote(secret.value, {
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      pickup_latitude: settings.latitude ?? undefined,
      pickup_longitude: settings.longitude ?? undefined,
      dropoff_latitude: order.delivery_latitude ?? undefined,
      dropoff_longitude: order.delivery_longitude ?? undefined,
      pickup_ready_dt: order.promised_at ?? undefined,
      manifest_total_value: order.total_cents,
    });

    const delivery = await dispatchDelivery(secret.value, {
      quote_id: quote.id,
      pickup_name: tenant.name ?? 'Restaurant',
      pickup_business_name: tenant.name ?? undefined,
      pickup_address: pickupAddress,
      pickup_phone_number: tenant.support_phone,
      pickup_latitude: settings.latitude ?? undefined,
      pickup_longitude: settings.longitude ?? undefined,
      dropoff_name: order.customer_name,
      dropoff_address: dropoffAddress,
      dropoff_phone_number: order.customer_phone,
      dropoff_latitude: order.delivery_latitude ?? undefined,
      dropoff_longitude: order.delivery_longitude ?? undefined,
      dropoff_notes: order.delivery_instructions ?? undefined,
      manifest_items: (order.order_items ?? []).map((item) => ({
        name: item.name_snapshot,
        quantity: item.quantity,
        size: 'small' as const,
      })),
      manifest_total_value: order.total_cents,
      external_id: order.order_number,
      pickup_ready_dt: order.promised_at ?? undefined,
    });

    const { error } = await service.rpc('record_dispatch_reference', {
      p_order_id: orderId,
      p_external_ref: delivery.id,
      p_status: mapUberStatus(delivery.status) ?? 'assigned',
      p_estimated_delivery_at: delivery.dropoff_eta ?? quote.dropoff_eta ?? undefined,
      p_tracking_url: delivery.tracking_url ?? undefined,
      p_provider: 'uber_direct',
      p_courier_name: delivery.courier?.name ?? undefined,
      p_courier_phone: delivery.courier?.phone_number ?? undefined,
    });

    if (error) {
      console.error('[dispatch] Dispatched but not recorded', orderId, delivery.id, error.message);
      return {
        dispatched: false,
        reason: 'Courier booked but database update failed; contact support',
      };
    }

    return { dispatched: true, provider: 'uber_direct', externalRef: delivery.id };
  } catch (error) {
    if (error instanceof UberDirectError) {
      await service
        .from('deliveries')
        .update({ failure_reason: error.message.slice(0, 500) })
        .eq('order_id', orderId);

      return { dispatched: false, reason: error.message };
    }

    console.error('[dispatch] Auto-dispatch failed', orderId, error);
    return {
      dispatched: false,
      reason: error instanceof Error ? error.message : 'Dispatch failed',
    };
  }
}

/**
 * Dispatch an order immediately after creation (Shipday path).
 *
 * Gracefully logs the dispatch payload when credentials are unavailable,
 * allowing staff to re-trigger dispatch later.
 */
async function autoDispatchShipday(orderId: string): Promise<AutoDispatchResult> {
  const service = createServiceClient();

  const { data: order } = await service
    .from('orders')
    .select('tenant_id, order_number')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { dispatched: false, reason: 'Order not found' };

  // Already dispatched.
  const { data: existing } = await service
    .from('deliveries')
    .select('external_ref, provider')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existing?.external_ref) {
    return { dispatched: true, provider: existing.provider ?? 'unknown', externalRef: existing.external_ref };
  }

  const { data: secret } = await service
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', order.tenant_id)
    .eq('key', 'shipday_api_key')
    .maybeSingle();

  if (!secret?.value) {
    return {
      dispatched: false,
      reason: 'Shipday API key not configured; set in tenant secrets',
    };
  }

  try {
    const { data, error } = await service.functions.invoke<{ ok: boolean; error?: string }>(
      'shipday-dispatch',
      { body: { orderId } },
    );

    if (error) {
      console.error('[dispatch] Shipday edge function error', orderId, error.message);
      await recordDispatchFailure(orderId, error.message);
      return { dispatched: false, reason: error.message };
    }

    if (!data?.ok) {
      const reason = data?.error ?? 'Courier dispatch was not accepted';
      console.error('[dispatch] Shipday dispatch failed', orderId, reason);
      await recordDispatchFailure(orderId, reason);
      return { dispatched: false, reason };
    }

    return { dispatched: true, provider: 'shipday', externalRef: order.order_number };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Courier dispatch failed';
    console.error('[dispatch] Shipday auto-dispatch failed', orderId, reason);
    await recordDispatchFailure(orderId, reason);
    return { dispatched: false, reason };
  }
}

/**
 * Record a dispatch failure so staff can retry.
 */
async function recordDispatchFailure(orderId: string, reason: string): Promise<void> {
  const service = createServiceClient();
  await service
    .from('deliveries')
    .update({ status: 'unassigned', failure_reason: reason.slice(0, 500) })
    .eq('order_id', orderId);
}

/**
 * Auto-dispatch immediately after order creation.
 *
 * Routes to the configured provider (Uber Direct or Shipday) or logs when
 * no credentials are configured, allowing manual dispatch later.
 */
export async function autoDispatch(orderId: string): Promise<AutoDispatchResult> {
  const service = createServiceClient();

  const { data: order } = await service
    .from('orders')
    .select('tenant_id, fulfillment_type')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { dispatched: false, reason: 'Order not found' };

  if (order.fulfillment_type !== 'delivery') {
    return { dispatched: false, reason: 'Only delivery orders are auto-dispatched' };
  }

  const provider = await configuredProvider(order.tenant_id);

  if (provider === 'uber_direct') {
    return autoDispatchUber(orderId);
  }

  if (provider === 'shipday') {
    return autoDispatchShipday(orderId);
  }

  return { dispatched: false, reason: 'No courier configured for this restaurant' };
}
