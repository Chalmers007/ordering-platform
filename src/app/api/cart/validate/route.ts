import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClientForRequest } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';
import { assertCartBalances, parsePricedCart } from '@/lib/pricing/priced-cart';
import type { Json } from '@/types/database';

/**
 * Server-side cart validation.
 *
 * The browser sends selections; `price_cart()` returns money. Everything the
 * customer could have tampered with — item prices, modifier deltas, whether
 * an item is still available, whether the kitchen is paused — is re-derived
 * from the database. A cart that no longer prices is rejected here, before
 * any Stripe session exists.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  cart: z.object({
    fulfillmentType: z.enum(['delivery', 'pickup']),
    tipCents: z.number().int().nonnegative().max(100_000).default(0),
    lines: z
      .array(
        z.object({
          lineId: z.string().min(1).max(256),
          menuItemId: z.string().uuid(),
          quantity: z.number().int().min(1).max(999),
          notes: z.string().max(500).optional(),
          modifiers: z
            .array(
              z.object({
                modifierId: z.string().uuid(),
                groupId: z.string().uuid().optional(),
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
});

function statusForPostgresError(code: string | undefined): number {
  switch (code) {
    case '42501': return 403;
    case '23514': return 409; // check_violation: sold out, paused, minimum not met
    case '23503': return 400;
    default: return 500;
  }
}

export async function POST(request: NextRequest) {
  const tenant = await getTenantContext();
  if (!tenant) {
    return NextResponse.json({ error: 'No storefront at this address' }, { status: 404 });
  }
  // A suspended or cancelled tenant is 403, not 404: the address resolves,
  // the restaurant just is not allowed to take orders.
  if (tenant.status !== 'active') {
    return NextResponse.json(
      { error: 'This restaurant is not currently accepting orders' },
      { status: 403 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid cart', fieldErrors: z.flattenError(error).fieldErrors },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const supabase = await createClientForRequest();

  // The tenant id comes from the Host header, never the body: a cart cannot
  // be priced against a restaurant the customer is not actually on.
  const { data, error } = await supabase.rpc('price_cart', {
    p_tenant_id: tenant.tenantId,
    p_cart: body.cart as unknown as Json,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: statusForPostgresError(error.code) },
    );
  }

  try {
    const pricedCart = parsePricedCart(data as Json);
    assertCartBalances(pricedCart);
    return NextResponse.json({ pricedCart });
  } catch (parseError) {
    return NextResponse.json(
      {
        error:
          parseError instanceof Error ? parseError.message : 'The cart could not be priced',
      },
      { status: 500 },
    );
  }
}
