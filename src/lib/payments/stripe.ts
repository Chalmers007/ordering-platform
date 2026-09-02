import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import type {
  PaymentSplit,
  PricedCart,
  TenantSettings,
} from '@/types/database';

/**
 * Stripe Connect — destination charges with an application fee.
 *
 * The customer is charged the full total. Stripe routes
 * `application_fee_amount` to the platform account and settles the remainder
 * to the restaurant's connected account. `on_behalf_of` makes the restaurant
 * the settlement merchant, which is what puts the charge in their statement
 * descriptor and tax jurisdiction rather than the platform's.
 *
 * Every exported function except `getStripe`/`createCheckoutSession` is pure,
 * so the fee split is provable without a network call or a Stripe key.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing required environment variable: STRIPE_SECRET_KEY');
  cached = new Stripe(key, { typescript: true, maxNetworkRetries: 2 });
  return cached;
}

/** Test seam. */
export function __setStripeForTesting(client: Stripe | null): void {
  cached = client;
}

// ---------------------------------------------------------------------
// Fee split
// ---------------------------------------------------------------------

export type FeeSettings = Pick<TenantSettings, 'tech_fee_enabled' | 'tech_fee_cents'>;

/**
 * The platform's cut, in cents.
 *
 * This is a flat per-order technology fee, never a percentage of the
 * restaurant's revenue. It is 0 whenever the tenant has the fee disabled,
 * and it must equal the tech fee the cart was priced with — otherwise the
 * customer was quoted one number and the split would use another.
 */
export function computeApplicationFeeCents(
  cart: Pick<PricedCart, 'techFeeCents'>,
  settings: FeeSettings,
): number {
  const configured = settings.tech_fee_enabled ? settings.tech_fee_cents : 0;

  if (cart.techFeeCents !== configured) {
    throw new Error(
      `Tech fee mismatch: cart was priced with ${cart.techFeeCents} but the tenant is configured for ${configured}`,
    );
  }

  return configured;
}

export function buildPaymentSplit(
  cart: PricedCart,
  settings: FeeSettings,
  destinationAccountId: string,
): PaymentSplit {
  return {
    totalCents: cart.totalCents,
    applicationFeeCents: computeApplicationFeeCents(cart, settings),
    destinationAccountId,
    provider: 'stripe',
    currency: cart.currency,
  };
}

/** What actually lands in the restaurant's balance, before Stripe's own
 *  processing fees. Used by tests and by the admin revenue view. */
export function netToConnectedAccountCents(split: PaymentSplit): number {
  return split.totalCents - split.applicationFeeCents;
}

// ---------------------------------------------------------------------
// Cart hash
// ---------------------------------------------------------------------

/**
 * A stable fingerprint of what was priced. Carried in Stripe metadata so the
 * webhook can prove the snapshot it builds the order from is the same one
 * the customer paid for.
 */
export function hashCart(cart: PricedCart): string {
  const canonical = JSON.stringify({
    lines: cart.lines.map((l) => ({
      i: l.menuItemId,
      q: l.quantity,
      u: l.unitPriceCents,
      m: [...l.modifiers]
        .map((m) => ({ i: m.modifierId, q: m.quantity, d: m.priceDeltaCents }))
        .sort((a, b) => a.i.localeCompare(b.i)),
    })),
    t: cart.totalCents,
    f: cart.techFeeCents,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------
// Checkout session construction
// ---------------------------------------------------------------------

export type CheckoutSessionInput = {
  checkoutSessionId: string;
  tenantId: string;
  tenantName: string;
  cart: PricedCart;
  settings: FeeSettings;
  destinationAccountId: string;
  customer: { name: string; phone: string; email: string | null };
  successUrl: string;
  cancelUrl: string;
};

/**
 * Every charged cent appears as its own line item, so the Stripe-hosted page
 * shows the customer the same breakdown the storefront did — including the
 * technology fee, itemised rather than buried in a total.
 */
export function buildLineItems(
  cart: PricedCart,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const currency = cart.currency.toLowerCase();
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  for (const line of cart.lines) {
    const modifierNames = line.modifiers.map((m) => m.name).join(', ');
    items.push({
      quantity: line.quantity,
      price_data: {
        currency,
        unit_amount: line.unitPriceCents + line.modifiersTotalCents,
        product_data: {
          name: line.name,
          ...(modifierNames ? { description: modifierNames } : {}),
        },
      },
    });
  }

  const surcharge = (name: string, amount: number) => {
    if (amount <= 0) return;
    items.push({
      quantity: 1,
      price_data: { currency, unit_amount: amount, product_data: { name } },
    });
  };

  surcharge('Delivery', cart.deliveryFeeCents);
  surcharge('Service fee', cart.serviceFeeCents);
  surcharge('Technology fee', cart.techFeeCents);
  surcharge('Sales tax', cart.taxCents);
  surcharge('Tip', cart.tipCents);

  return items;
}

export function lineItemsTotalCents(
  items: Stripe.Checkout.SessionCreateParams.LineItem[],
): number {
  return items.reduce(
    (sum, item) => sum + (item.price_data?.unit_amount ?? 0) * (item.quantity ?? 1),
    0,
  );
}

export function buildCheckoutSessionParams(
  input: CheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const { cart, settings, destinationAccountId } = input;

  if (cart.discountCents > 0) {
    // price_cart() returns 0 until promotions exist. If that changes, the
    // line items above must express the discount before this is relaxed —
    // otherwise Stripe would charge more than the customer was quoted.
    throw new Error('Discounts are not supported by this checkout build');
  }

  const applicationFeeCents = computeApplicationFeeCents(cart, settings);
  const lineItems = buildLineItems(cart);
  const lineTotal = lineItemsTotalCents(lineItems);

  if (lineTotal !== cart.totalCents) {
    throw new Error(
      `Stripe line items total ${lineTotal} but the cart total is ${cart.totalCents}`,
    );
  }

  // Metadata is capped at 500 characters per value, so it carries pointers
  // and proofs — never the cart itself. The cart lives in checkout_sessions.
  const metadata: Stripe.MetadataParam = {
    checkout_session_id: input.checkoutSessionId,
    tenant_id: input.tenantId,
    cart_hash: hashCart(cart),
    fulfillment_type: cart.fulfillmentType,
    customer_phone: input.customer.phone,
    ...(input.customer.email ? { customer_email: input.customer.email } : {}),
    tech_fee_cents: String(cart.techFeeCents),
    application_fee_cents: String(applicationFeeCents),
  };

  return {
    mode: 'payment',
    line_items: lineItems,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.checkoutSessionId,
    ...(input.customer.email ? { customer_email: input.customer.email } : {}),
    metadata,
    payment_intent_data: {
      // The split. application_fee_amount goes to the platform; the balance
      // settles to the restaurant's connected account.
      application_fee_amount: applicationFeeCents,
      transfer_data: { destination: destinationAccountId },
      on_behalf_of: destinationAccountId,
      description: `${input.tenantName} order`,
      // Repeated because Checkout does not copy session metadata onto the
      // PaymentIntent, and the webhook may arrive as payment_intent.succeeded.
      metadata,
    },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  };
}

export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<Stripe.Checkout.Session> {
  return getStripe().checkout.sessions.create(buildCheckoutSessionParams(input), {
    // Stripe deduplicates on this key, so a retried request cannot create a
    // second session — or a second charge — for the same checkout.
    idempotencyKey: `checkout:${input.checkoutSessionId}`,
  });
}

// ---------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

/**
 * Verifies the payload against STRIPE_WEBHOOK_SECRET. An unverified body is
 * attacker-controlled input claiming a payment succeeded — it never reaches
 * order creation.
 */
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Missing required environment variable: STRIPE_WEBHOOK_SECRET');
  if (!signature) throw new StripeSignatureError('Missing stripe-signature header');

  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    throw new StripeSignatureError(
      error instanceof Error ? error.message : 'Signature verification failed',
    );
  }
}
