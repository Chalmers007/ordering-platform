import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';
import { autoDispatch } from '@/lib/dispatch/auto-dispatch';
import type { Json } from '@/types/database';

/**
 * POST /api/orders/create
 *
 * Create an order directly from cart + customer + delivery data.
 *
 * The route:
 * 1. Prices the cart server-side using the database as authority
 * 2. Creates the order, line items, and delivery record atomically
 * 3. Triggers auto-dispatch if configured
 * 4. Returns the tracking token for customer access
 *
 * This route bypasses Stripe and is used when payments are omitted or
 * handled separately from the checkout flow.
 */
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

function statusForPostgresError(code: string | undefined): number {
  switch (code) {
    case '42501':
      return 403; // insufficient_privilege
    case '23514':
      return 400; // check_violation
    case '23503':
      return 400; // foreign_key_violation
    case '02000':
      return 404; // no_data_found
    default:
      return 500;
  }
}

export async function POST(request: NextRequest) {
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
        { error: 'Invalid order request', fieldErrors: z.flattenError(error).fieldErrors },
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

  const service = createServiceClient();

  // ---- price the cart server-side -----------------------------------
  const { data: pricedCart, error: priceError } = await service.rpc('price_cart', {
    p_tenant_id: tenant.tenantId,
    p_cart: body.cart as unknown as Json,
  });

  if (priceError) {
    return NextResponse.json(
      { error: priceError.message },
      { status: statusForPostgresError(priceError.code) },
    );
  }

  if (!pricedCart || typeof pricedCart !== 'object') {
    return NextResponse.json({ error: 'Pricing failed' }, { status: 500 });
  }

  // ---- create the order atomically ----------------------------------
  const { data: orderResult, error: createError } = await service.rpc(
    'create_order_direct',
    {
      p_tenant_id: tenant.tenantId,
      p_priced_cart: pricedCart as unknown as Json,
      p_customer_name: body.customer.name,
      p_customer_phone: body.customer.phone,
      p_customer_email: body.customer.email ?? undefined,
      p_fulfillment_type: body.cart.fulfillmentType,
      p_delivery_address_line1: body.delivery?.addressLine1,
      p_delivery_address_line2: body.delivery?.addressLine2,
      p_delivery_city: body.delivery?.city,
      p_delivery_region: body.delivery?.region,
      p_delivery_postal_code: body.delivery?.postalCode,
      p_delivery_country: (body.delivery?.country ?? 'US') as 'US',
      p_delivery_latitude: body.delivery?.latitude,
      p_delivery_longitude: body.delivery?.longitude,
      p_delivery_instructions: body.delivery?.instructions,
    },
  );

  if (createError) {
    return NextResponse.json(
      { error: createError.message },
      { status: statusForPostgresError(createError.code) },
    );
  }

  if (!orderResult || orderResult.length === 0) {
    return NextResponse.json({ error: 'Order creation failed' }, { status: 500 });
  }

  const { order_id: orderId, tracking_token: trackingToken } = orderResult[0];

  if (!orderId || !trackingToken) {
    return NextResponse.json({ error: 'Order creation failed' }, { status: 500 });
  }

  // ---- auto-dispatch if configured ---------------------------------
  // Dispatch failures do not fail the order creation — the order is placed
  // and the kitchen still needs it. Dispatch can be retried from the KDS.
  try {
    const dispatchResult = await autoDispatch(orderId);
    if (!dispatchResult.dispatched) {
      console.info('[orders/create] Auto-dispatch skipped', {
        orderId,
        reason: dispatchResult.reason,
      });
    }
  } catch (error) {
    console.error('[orders/create] Auto-dispatch failed', orderId, error);
  }

  return NextResponse.json({
    orderId,
    trackingToken,
    trackingUrl: `/orders/${trackingToken}`,
    pricedCart,
  });
}
