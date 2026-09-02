import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { constructWebhookEvent, hashCart, StripeSignatureError } from '@/lib/payments/stripe';
import { parsePricedCart } from '@/lib/pricing/priced-cart';
import { triggerDispatch } from '@/lib/dispatch/dispatch';
import type { Json } from '@/types/database';

/**
 * Stripe webhook.
 *
 * Reached at the platform root (no tenant subdomain), so middleware routes it
 * as a marketing-surface /api request and passes it straight through — no
 * rewrite, no auth redirect, no tenant header. The tenant is derived from the
 * checkout session the event points at.
 *
 * Signature verification needs the exact bytes Stripe signed, so the body is
 * read as text and never parsed before verification.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDLED = new Set<string>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'payment_intent.succeeded',
]);

type Extracted = {
  checkoutSessionId: string | null;
  cartHash: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  applicationFeeCents: number | null;
};

function extract(event: Stripe.Event): Extracted {
  const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
  const metadata = object.metadata ?? {};

  const asId = (value: unknown): string | null =>
    typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value
      ? String((value as { id: string }).id)
      : null;

  if (event.type === 'payment_intent.succeeded') {
    const intent = object as Stripe.PaymentIntent;
    return {
      checkoutSessionId: metadata.checkout_session_id ?? null,
      cartHash: metadata.cart_hash ?? null,
      paymentIntentId: intent.id,
      chargeId: asId(intent.latest_charge),
      // The authoritative figure: what Stripe actually routed to the
      // platform. Falls back to the value we asked for.
      applicationFeeCents:
        typeof intent.application_fee_amount === 'number'
          ? intent.application_fee_amount
          : metadata.application_fee_cents
            ? Number(metadata.application_fee_cents)
            : null,
    };
  }

  const session = object as Stripe.Checkout.Session;
  return {
    checkoutSessionId: metadata.checkout_session_id ?? session.client_reference_id ?? null,
    cartHash: metadata.cart_hash ?? null,
    paymentIntentId: asId(session.payment_intent),
    chargeId: null,
    applicationFeeCents: metadata.application_fee_cents
      ? Number(metadata.application_fee_cents)
      : null,
  };
}

/** Only act on an event that represents money actually taken. */
function isPaid(event: Stripe.Event): boolean {
  if (event.type === 'payment_intent.succeeded') return true;
  const session = event.data.object as Stripe.Checkout.Session;
  return session.payment_status === 'paid';
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, request.headers.get('stripe-signature'));
  } catch (error) {
    if (error instanceof StripeSignatureError) {
      // 400, never 500: a bad signature is a rejected request, not an outage,
      // and Stripe must not retry it.
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 500 });
  }

  const service = createServiceClient();

  // ---- idempotency ------------------------------------------------------
  // The unique index on (provider, event_id) is the guarantee. A redelivery
  // loses this insert and returns before touching an order.
  const { error: ledgerError } = await service.from('inbound_webhook_events').insert({
    provider: 'stripe',
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Json,
  });

  if (ledgerError) {
    if (ledgerError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }

  const finish = async (patch: { error?: string; orderId?: string; tenantId?: string }) => {
    await service
      .from('inbound_webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        error: patch.error ?? null,
        order_id: patch.orderId ?? null,
        tenant_id: patch.tenantId ?? null,
      })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
  };

  if (!HANDLED.has(event.type) || !isPaid(event)) {
    await finish({});
    return NextResponse.json({ received: true, ignored: true });
  }

  const { checkoutSessionId, cartHash, paymentIntentId, chargeId, applicationFeeCents } =
    extract(event);

  if (!checkoutSessionId) {
    await finish({ error: 'Event carried no checkout_session_id' });
    // 200: retrying will not add a checkout session id.
    return NextResponse.json({ received: true, ignored: true });
  }

  // ---- the snapshot the customer actually paid for ----------------------
  const { data: checkout, error: checkoutError } = await service
    .from('checkout_sessions')
    .select('id, tenant_id, priced_cart, order_id, status')
    .eq('id', checkoutSessionId)
    .maybeSingle();

  if (checkoutError || !checkout) {
    await finish({ error: `Unknown checkout session ${checkoutSessionId}` });
    return NextResponse.json({ error: 'Unknown checkout session' }, { status: 404 });
  }

  // Tamper check: the cart Stripe signed must be the cart we stored.
  if (cartHash) {
    try {
      const stored = hashCart(parsePricedCart(checkout.priced_cart));
      if (stored !== cartHash) {
        await finish({
          error: 'Cart hash mismatch between the Stripe event and the stored snapshot',
          tenantId: checkout.tenant_id,
        });
        return NextResponse.json({ error: 'Cart mismatch' }, { status: 409 });
      }
    } catch {
      await finish({ error: 'Stored cart snapshot is unreadable', tenantId: checkout.tenant_id });
      return NextResponse.json({ error: 'Invalid cart snapshot' }, { status: 500 });
    }
  }

  // ---- atomic order creation -------------------------------------------
  // orders + order_items + order_item_modifiers + deliveries + the outbound
  // GHL events, in one transaction. The deferred trigger re-derives the
  // subtotal from the inserted line items and re-checks tech_fee_cents
  // against tenant_settings at COMMIT; a mismatch rolls the whole thing back.
  const { data: orderId, error: orderError } = await service.rpc('create_order_from_checkout', {
    p_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId ?? undefined,
    p_charge_id: chargeId ?? undefined,
    p_application_fee_cents: applicationFeeCents ?? 0,
  });

  if (orderError || !orderId) {
    await finish({
      error: orderError?.message ?? 'Order creation returned no id',
      tenantId: checkout.tenant_id,
    });
    // 500 so Stripe retries: the customer has been charged and the order
    // must exist. Idempotency makes the retry safe.
    return NextResponse.json({ error: 'Order creation failed' }, { status: 500 });
  }

  await finish({ orderId, tenantId: checkout.tenant_id });

  // ---- dispatch ---------------------------------------------------------
  // Deliberately after the ledger is settled and never fatal: the order is
  // paid and the kitchen needs it regardless. A failure leaves the delivery
  // row `unassigned` with a reason recorded.
  const dispatch = await triggerDispatch(orderId);

  return NextResponse.json({
    received: true,
    orderId,
    dispatched: dispatch.dispatched,
  });
}
