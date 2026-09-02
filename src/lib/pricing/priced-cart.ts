import { z } from 'zod';
import type { Json, PricedCart } from '@/types/database';

/**
 * price_cart() is the authority on money, but it returns `Json`. This schema
 * is the boundary where untyped JSON becomes a `PricedCart` — parsed once,
 * here, rather than cast with `as` at a dozen call sites.
 */
const cents = z.number().int();

export const pricedCartSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string(),
        menuItemId: z.string().uuid(),
        name: z.string(),
        quantity: z.number().int().positive(),
        unitPriceCents: cents.nonnegative(),
        modifiersTotalCents: cents,
        lineTotalCents: cents.nonnegative(),
        notes: z.string().nullable().default(null),
        modifiers: z.array(
          z.object({
            modifierId: z.string().uuid(),
            groupName: z.string(),
            name: z.string(),
            priceDeltaCents: cents,
            quantity: z.number().int().positive(),
          }),
        ),
      }),
    )
    .min(1),
  subtotalCents: cents.nonnegative(),
  discountCents: cents.nonnegative(),
  taxCents: cents.nonnegative(),
  tipCents: cents.nonnegative(),
  deliveryFeeCents: cents.nonnegative(),
  serviceFeeCents: cents.nonnegative(),
  techFeeCents: cents.nonnegative(),
  totalCents: cents.nonnegative(),
  currency: z.string().length(3),
  fulfillmentType: z.enum(['delivery', 'pickup']),
});

export function parsePricedCart(value: Json): PricedCart {
  return pricedCartSchema.parse(value) satisfies PricedCart;
}

/**
 * The same identity the `orders_total_chk` constraint enforces. Checked in
 * the API route so a bad total fails at the edge with a clear message
 * instead of as a constraint violation three steps later.
 */
export function assertCartBalances(cart: PricedCart): void {
  const expected =
    cart.subtotalCents -
    cart.discountCents +
    cart.taxCents +
    cart.tipCents +
    cart.deliveryFeeCents +
    cart.serviceFeeCents +
    cart.techFeeCents;

  if (expected !== cart.totalCents) {
    throw new Error(
      `Priced cart does not balance: components sum to ${expected} but total is ${cart.totalCents}`,
    );
  }

  const lineSum = cart.lines.reduce((n, l) => n + l.lineTotalCents, 0);
  if (lineSum !== cart.subtotalCents) {
    throw new Error(
      `Priced cart subtotal ${cart.subtotalCents} does not match its lines (${lineSum})`,
    );
  }
}
