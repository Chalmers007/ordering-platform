import { NextResponse, type NextRequest } from 'next/server';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import {
  UberDirectError,
  createDeliveryQuote,
  dispatchDelivery,
  mapUberStatus,
} from '@/lib/uber';

/**
 * Dispatch a delivery order to Uber Direct.
 *
 * Called by the KDS when an order starts being prepared, so the courier is
 * already on the way while the food is being made. Idempotent: an order
 * that already has a courier job returns the existing one rather than
 * booking a second driver for the same food.
 *
 * The caller is authorised through their own session (staff of the tenant,
 * or a super admin); the courier call itself uses the platform's
 * credentials via the service role, so no browser ever sees them.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const supabase = await createClientForRequest();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS scopes this read to orders the caller may see, so a staff member
  // cannot dispatch another restaurant's order by guessing an id.
  const { data: order } = await supabase
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

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const service = createServiceClient();

  // Already dispatched: say so and stop before validating mutable order
  // details. A later retry must never create or imply a second booking.
  const { data: existing } = await service
    .from('deliveries')
    .select('external_ref, provider, tracking_url, status')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existing?.external_ref) {
    return NextResponse.json({
      dispatched: true,
      alreadyDispatched: true,
      status: existing.status,
    });
  }

  if (order.fulfillment_type !== 'delivery') {
    return NextResponse.json({ error: 'That order is for pickup' }, { status: 409 });
  }
  if (order.status !== 'confirmed' && order.status !== 'preparing') {
    return NextResponse.json(
      { error: 'The order must be accepted or preparing before dispatch' },
      { status: 409 },
    );
  }
  if (!order.delivery_address_line1 || !order.delivery_city || !order.delivery_postal_code) {
    return NextResponse.json({ error: 'That order has no delivery address' }, { status: 409 });
  }

  // Per-tenant merchant id and pickup address.
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
    return NextResponse.json(
      { error: 'This restaurant is not connected to the courier network' },
      { status: 409 },
    );
  }
  if (!settings?.address_line1 || !settings.city || !settings.postal_code) {
    return NextResponse.json(
      { error: 'Add your restaurant address in Store Settings before dispatching' },
      { status: 409 },
    );
  }
  if (!tenant?.support_phone) {
    return NextResponse.json(
      { error: 'Add your restaurant phone number in Store Settings before dispatching' },
      { status: 409 },
    );
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
    // A quote is required first and is short-lived, so it is requested
    // immediately before the delivery rather than cached anywhere.
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
      pickup_name: tenant?.name ?? 'Restaurant',
      pickup_business_name: tenant?.name ?? undefined,
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
      // Lets a webhook be traced back to an order even if our own record
      // is somehow missing.
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
      // The courier has the job but we failed to record it — that is worse
      // than a failed dispatch, because nothing will reconcile it. Say so.
      console.error('dispatched but not recorded', orderId, delivery.id, error.message);
      return NextResponse.json(
        { error: 'The delivery was booked but could not be saved. Contact support before retrying.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ dispatched: true, status: delivery.status });
  } catch (error) {
    if (error instanceof UberDirectError) {
      await service
        .from('deliveries')
        .update({ failure_reason: error.message.slice(0, 500) })
        .eq('order_id', orderId);

      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.status >= 500 ? 502 : 409 },
      );
    }

    console.error('dispatch failed', orderId, error);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 });
  }
}
