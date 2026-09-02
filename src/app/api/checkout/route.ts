import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';
import { assertCartBalances, parsePricedCart } from '@/lib/pricing/priced-cart';
import { createCheckoutSession } from '@/lib/payments/stripe';
import type { Json } from '@/types/database';

// The Stripe SDK needs Node APIs, and this route must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  cart: z.object({
    fulfillmentType: z.enum(['delivery', 'pickup']),
    tipCents: z.number().int().nonnegative().max(100_000).default(0),
    lines: z
      .array(
        z.object({
          lineId: z.string().min(1).max(64),
          menuItemId: z.string().uuid(),
          quantity: z.number().int().min(1).max(999),
          notes: z.string().max(500).optional(),
          modifiers: z
            .array(
              z.object({
                modifierId: z.string().uuid(),
                quantity: z.number().int().min(1).max(99).default(1),
              }),
            )
            .max(50)
            .default([]),
        }),
      )
      .min(1)
      .max(100),
  }),
  customer: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(7).max(32),
    email: z.string().email().max(254).nullish(),
  }),
  delivery: z
    .object({
      addressLine1: z.string().min(1).max(200),
      addressLine2: z.string().max(200).optional(),
      city: z.string().min(1).max(120),
      region: z.string().max(120).optional(),
      postalCode: z.string().min(1).max(20),
      country: z.string().length(2).default('US'),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      instructions: z.string().max(500).optional(),
    })
    .optional(),
});

/** Postgres raises the same conditions the UI needs to explain. Map them
 *  rather than returning a generic 500 for a sold-out item. */
function statusForPostgresError(code: string | undefined): number {
  switch (code) {
    case '42501': return 403; // insufficient_privilege — not signed in / wrong tenant
    case '23514': return 400; // check_violation — sold out, paused, minimum not met
    case '23503': return 400; // foreign_key_violation
    case '02000': return 404; // no_data_found
    default: return 500;
  }
}

export async function POST(request: NextRequest) {
  // The tenant comes from the Host header via middleware, never from the
  // body. A client cannot check out against a restaurant it is not on.
  const tenant = await getTenantContext();
  if (!tenant) {
    return NextResponse.json(
      { error: 'No storefront is configured for this address' },
      { status: 404 },
    );
  }
  if (tenant.status !== 'active') {
    return NextResponse.json(
      { error: 'This restaurant is not currently accepting orders' },
      { status: 409 },
    );
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid checkout request', fieldErrors: z.flattenError(error).fieldErrors },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  if (body.cart.fulfillmentType === 'delivery' && !body.delivery) {
    return NextResponse.json(
      { error: 'A delivery address is required for delivery orders' },
      { status: 422 },
    );
  }

  const supabase = await createClientForRequest();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Verify your phone number before checking out' },
      { status: 401 },
    );
  }

  // ---- price and persist the cart, server-side -------------------------
  // open_checkout_session() prices from the database and writes the snapshot.
  // Nothing the client sent about money is trusted or even read.
  const { data: opened, error: openError } = await supabase.rpc('open_checkout_session', {
    p_tenant_id: tenant.tenantId,
    p_cart: body.cart as unknown as Json,
    p_customer: body.customer as unknown as Json,
    p_delivery: (body.delivery ?? {}) as unknown as Json,
  });

  if (openError) {
    return NextResponse.json(
      { error: openError.message },
      { status: statusForPostgresError(openError.code) },
    );
  }

  const openedResult = opened as { sessionId: string; pricedCart: Json } | null;
  if (!openedResult?.sessionId) {
    return NextResponse.json({ error: 'Checkout could not be started' }, { status: 500 });
  }

  const checkoutSessionId = openedResult.sessionId;
  const cart = parsePricedCart(openedResult.pricedCart);
  assertCartBalances(cart);

  // ---- tenant fee configuration and connected account -------------------
  const { data: settings, error: settingsError } = await supabase
    .from('tenant_settings')
    .select('tech_fee_enabled, tech_fee_cents')
    .eq('tenant_id', tenant.tenantId)
    .single();

  if (settingsError || !settings) {
    return NextResponse.json({ error: 'Restaurant is not configured' }, { status: 409 });
  }

  // payment_gateway_accounts is owner-only under RLS, and the customer is
  // not an owner. The tenant id here came from the middleware header, not
  // from the request body, so a service-role read is scoped to a tenant the
  // caller could not have chosen.
  const service = createServiceClient();
  const { data: gateway, error: gatewayError } = await service
    .from('payment_gateway_accounts')
    .select('external_account_id, charges_enabled, status')
    .eq('tenant_id', tenant.tenantId)
    .eq('provider', 'stripe')
    .maybeSingle();

  if (gatewayError) {
    return NextResponse.json({ error: 'Could not load payment configuration' }, { status: 500 });
  }
  if (!gateway?.external_account_id || gateway.status !== 'active' || !gateway.charges_enabled) {
    return NextResponse.json(
      { error: 'This restaurant cannot accept online payments yet' },
      { status: 409 },
    );
  }

  // ---- Stripe -----------------------------------------------------------
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const origin = `${proto}://${tenant.hostname}`;

  let session;
  try {
    session = await createCheckoutSession({
      checkoutSessionId,
      tenantId: tenant.tenantId,
      tenantName: tenant.name,
      cart,
      settings,
      destinationAccountId: gateway.external_account_id,
      customer: {
        name: body.customer.name,
        phone: body.customer.phone,
        email: body.customer.email ?? null,
      },
      // The order does not exist until the webhook lands, so the customer
      // returns holding a checkout session id; this route resolves it.
      successUrl: `${origin}/orders/session/${checkoutSessionId}`,
      cancelUrl: `${origin}/checkout?status=cancelled`,
    });
  } catch (error) {
    await service
      .from('checkout_sessions')
      .update({ status: 'cancelled' })
      .eq('id', checkoutSessionId);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Payment could not be started' },
      { status: 502 },
    );
  }

  // Bind the Stripe session to our snapshot so the webhook can find it even
  // if the customer never returns to the success URL.
  const { error: bindError } = await service
    .from('checkout_sessions')
    .update({
      provider_session_id: session.id,
      provider_payment_intent_id:
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
    })
    .eq('id', checkoutSessionId);

  if (bindError) {
    return NextResponse.json({ error: 'Checkout could not be started' }, { status: 500 });
  }

  return NextResponse.json({
    checkoutSessionId,
    url: session.url,
    // Returned so the storefront can show the same breakdown Stripe will.
    pricedCart: cart,
  });
}
