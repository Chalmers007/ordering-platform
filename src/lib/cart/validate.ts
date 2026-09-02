import type { Cart, PricedCart } from '@/types/database';

export type CartValidationResult =
  | { ok: true; pricedCart: PricedCart }
  | { ok: false; error: string; status: number };

/**
 * Re-prices the cart against the database before the customer is sent to
 * payment. The response is the only price the UI is allowed to show at
 * checkout — a client-side subtotal is a preview, not a quote.
 */
export async function validateCart(cart: Cart): Promise<CartValidationResult> {
  let response: Response;
  try {
    response = await fetch('/api/cart/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the restaurant. Check your connection.', status: 0 };
  }

  const body = (await response.json().catch(() => null)) as
    | { pricedCart?: PricedCart; error?: string }
    | null;

  if (!response.ok || !body?.pricedCart) {
    return {
      ok: false,
      error: body?.error ?? 'This order could not be priced',
      status: response.status,
    };
  }

  return { ok: true, pricedCart: body.pricedCart };
}
