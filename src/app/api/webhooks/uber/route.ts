import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { mapUberStatus } from '@/lib/uber';
import { verifyUberSignature } from '@/lib/uber-signature';
import type { Json } from '@/types/database';

/**
 * Uber Direct status webhook.
 *
 * Writes straight into Postgres, which is what makes the customer's
 * tracking page move: it subscribes to `orders` and `deliveries` over
 * Realtime, so a driver collecting the food updates their screen without
 * anyone polling.
 *
 * The body is read as text and verified before it is parsed — an
 * unverified payload is an anonymous claim that someone's order was
 * delivered.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UberEvent = {
  event_id?: string;
  event_type?: string;
  delivery_id?: string;
  status?: string;
  data?: {
    id?: string;
    status?: string;
    tracking_url?: string;
    dropoff_eta?: string;
    courier?: {
      name?: string;
      phone_number?: string;
      location?: { lat?: number; lng?: number };
    };
  };
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.UBER_DIRECT_WEBHOOK_SECRET;

  if (!secret) {
    console.error('uber webhook received but UBER_DIRECT_WEBHOOK_SECRET is unset');
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 500 });
  }

  if (!verifyUberSignature(rawBody, request.headers.get('x-uber-signature'), secret)) {
    // 401, never 500: a bad signature is a rejected request, not an outage,
    // and the sender should not retry it.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: UberEvent;
  try {
    event = JSON.parse(rawBody) as UberEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  const deliveryId = event.data?.id ?? event.delivery_id;
  const rawStatus = event.data?.status ?? event.status;

  if (!deliveryId) {
    return NextResponse.json({ received: true, ignored: 'no delivery id' });
  }

  const service = createServiceClient();

  // Idempotency. Couriers redeliver, and applying a 'delivered' event twice
  // would be harmless here but a duplicate 'picked_up' would re-stamp
  // timestamps. The unique index on (provider, event_id) is the guarantee.
  const eventId = event.event_id ?? `${deliveryId}:${rawStatus ?? 'unknown'}`;

  const { error: ledgerError } = await service.from('inbound_webhook_events').insert({
    provider: 'uber_direct',
    event_id: eventId,
    event_type: event.event_type ?? rawStatus ?? 'delivery.status',
    payload: event as unknown as Json,
  });

  if (ledgerError) {
    if (ledgerError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }

  const status = mapUberStatus(rawStatus);
  if (!status) {
    // An unrecognised status is recorded and ignored rather than guessed:
    // mapping an unknown value onto 'delivered' would close an order that
    // is still out for delivery.
    await service
      .from('inbound_webhook_events')
      .update({ processed_at: new Date().toISOString(), error: `Unmapped status "${rawStatus}"` })
      .eq('provider', 'uber_direct')
      .eq('event_id', eventId);

    return NextResponse.json({ received: true, ignored: 'unmapped status' });
  }

  const location = event.data?.courier?.location;

  const { data: orderId, error: applyError } = await service.rpc('apply_delivery_event', {
    p_provider: 'uber_direct',
    p_external_ref: deliveryId,
    p_status: status,
    p_courier_name: event.data?.courier?.name ?? undefined,
    p_courier_phone: event.data?.courier?.phone_number ?? undefined,
    p_latitude: typeof location?.lat === 'number' ? location.lat : undefined,
    p_longitude: typeof location?.lng === 'number' ? location.lng : undefined,
    p_tracking_url: event.data?.tracking_url ?? undefined,
    p_estimated_delivery_at: event.data?.dropoff_eta ?? undefined,
  });

  if (applyError) {
    await service
      .from('inbound_webhook_events')
      .update({ processed_at: new Date().toISOString(), error: applyError.message })
      .eq('provider', 'uber_direct')
      .eq('event_id', eventId);

    return NextResponse.json({ error: 'Could not apply delivery status' }, { status: 500 });
  }

  await service
    .from('inbound_webhook_events')
    .update({
      processed_at: new Date().toISOString(),
      order_id: orderId ?? null,
      error: orderId ? null : 'No delivery matched that job id',
    })
    .eq('provider', 'uber_direct')
    .eq('event_id', eventId);

  // 200 even when nothing matched: the job belongs to another environment
  // or a deleted order, and retrying will not change that.
  return NextResponse.json({ received: true, orderId: orderId ?? null, status });
}
