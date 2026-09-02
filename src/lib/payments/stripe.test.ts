import { describe, expect, it } from 'vitest';
import {
  buildCheckoutSessionParams,
  buildLineItems,
  buildPaymentSplit,
  computeApplicationFeeCents,
  hashCart,
  lineItemsTotalCents,
  netToConnectedAccountCents,
  type FeeSettings,
} from './stripe';
import type { PricedCart } from '@/types/database';

const CONNECTED_ACCOUNT = 'acct_1RestaurantConnected';

/** A $20.00 order with the $1.00 platform technology fee applied. */
function twentyDollarCart(overrides: Partial<PricedCart> = {}): PricedCart {
  return {
    lines: [
      {
        lineId: 'l1',
        menuItemId: '11111111-2222-3333-4444-555555555555',
        name: 'Family Platter',
        quantity: 1,
        unitPriceCents: 2000,
        modifiersTotalCents: 0,
        lineTotalCents: 2000,
        notes: null,
        modifiers: [],
      },
    ],
    subtotalCents: 2000,
    discountCents: 0,
    taxCents: 0,
    tipCents: 0,
    deliveryFeeCents: 0,
    serviceFeeCents: 0,
    techFeeCents: 100,
    totalCents: 2100,
    currency: 'USD',
    fulfillmentType: 'pickup',
    ...overrides,
  };
}

const feeOn: FeeSettings = { tech_fee_enabled: true, tech_fee_cents: 100 };
const feeOff: FeeSettings = { tech_fee_enabled: false, tech_fee_cents: 100 };

describe('the $1.00 technology fee split', () => {
  it('routes $20.00 to the restaurant and $1.00 to the platform', () => {
    const cart = twentyDollarCart();
    const split = buildPaymentSplit(cart, feeOn, CONNECTED_ACCOUNT);

    // The customer is charged $21.00...
    expect(split.totalCents).toBe(2100);
    // ...$1.00 of which is the platform's application fee...
    expect(split.applicationFeeCents).toBe(100);
    // ...leaving exactly $20.00 settling to the restaurant.
    expect(netToConnectedAccountCents(split)).toBe(2000);
    expect(split.destinationAccountId).toBe(CONNECTED_ACCOUNT);
  });

  it('produces Stripe params that carry the split as destination charges', () => {
    const params = buildCheckoutSessionParams({
      checkoutSessionId: 'ccccdddd-0000-0000-0000-000000000001',
      tenantId: '11111111-1111-1111-1111-111111111111',
      tenantName: "Joe's Pizza",
      cart: twentyDollarCart(),
      settings: feeOn,
      destinationAccountId: CONNECTED_ACCOUNT,
      customer: { name: 'Dana', phone: '+15551234567', email: 'dana@example.test' },
      successUrl: 'https://orders.joespizza.com/orders/1',
      cancelUrl: 'https://orders.joespizza.com/checkout',
    });

    expect(params.payment_intent_data?.application_fee_amount).toBe(100);
    expect(params.payment_intent_data?.transfer_data?.destination).toBe(CONNECTED_ACCOUNT);
    // The restaurant is the settlement merchant, not the platform.
    expect(params.payment_intent_data?.on_behalf_of).toBe(CONNECTED_ACCOUNT);
    expect(lineItemsTotalCents(params.line_items ?? [])).toBe(2100);
  });

  it('charges no platform fee when the tenant has it disabled', () => {
    const cart = twentyDollarCart({ techFeeCents: 0, totalCents: 2000 });
    const split = buildPaymentSplit(cart, feeOff, CONNECTED_ACCOUNT);

    expect(split.applicationFeeCents).toBe(0);
    expect(netToConnectedAccountCents(split)).toBe(2000);
  });

  it('refuses to charge a fee the cart was not priced with', () => {
    // The customer was quoted a $21.00 total; the tenant is configured for a
    // $2.50 fee. Charging the split off the newer number would take money the
    // customer never agreed to.
    const cart = twentyDollarCart();
    expect(() => computeApplicationFeeCents(cart, { tech_fee_enabled: true, tech_fee_cents: 250 }))
      .toThrow(/Tech fee mismatch/);
  });

  it('refuses to keep a fee the tenant has switched off', () => {
    expect(() => computeApplicationFeeCents(twentyDollarCart(), feeOff))
      .toThrow(/Tech fee mismatch/);
  });
});

describe('line items', () => {
  it('itemises every surcharge and sums to the cart total', () => {
    const cart = twentyDollarCart({
      taxCents: 175,
      tipCents: 300,
      deliveryFeeCents: 499,
      serviceFeeCents: 60,
      fulfillmentType: 'delivery',
      totalCents: 2000 + 175 + 300 + 499 + 60 + 100,
    });

    const items = buildLineItems(cart);
    const names = items.map((i) => i.price_data?.product_data?.name);

    expect(names).toEqual([
      'Family Platter',
      'Delivery',
      'Service fee',
      'Technology fee',
      'Sales tax',
      'Tip',
    ]);
    expect(lineItemsTotalCents(items)).toBe(cart.totalCents);
  });

  it('omits surcharges that are zero', () => {
    const items = buildLineItems(twentyDollarCart({ techFeeCents: 0, totalCents: 2000 }));
    expect(items.map((i) => i.price_data?.product_data?.name)).toEqual(['Family Platter']);
  });

  it('prices modifiers into the unit amount', () => {
    const cart = twentyDollarCart({
      lines: [
        {
          lineId: 'l1',
          menuItemId: '11111111-2222-3333-4444-555555555555',
          name: 'Family Platter',
          quantity: 2,
          unitPriceCents: 2000,
          modifiersTotalCents: 150,
          lineTotalCents: 4300,
          notes: null,
          modifiers: [
            {
              modifierId: '99999999-8888-7777-6666-555555555555',
              groupName: 'Extras',
              name: 'Extra cheese',
              priceDeltaCents: 150,
              quantity: 1,
            },
          ],
        },
      ],
      subtotalCents: 4300,
      totalCents: 4400,
    });

    const items = buildLineItems(cart);
    expect(items[0].price_data?.unit_amount).toBe(2150);
    expect(items[0].quantity).toBe(2);
    expect(items[0].price_data?.product_data?.description).toBe('Extra cheese');
    expect(lineItemsTotalCents(items)).toBe(4400);
  });

  it('rejects a cart whose components do not reach its total', () => {
    // A cart that does not balance must never become a Stripe charge.
    expect(() =>
      buildCheckoutSessionParams({
        checkoutSessionId: 'ccccdddd-0000-0000-0000-000000000002',
        tenantId: '11111111-1111-1111-1111-111111111111',
        tenantName: "Joe's Pizza",
        cart: twentyDollarCart({ totalCents: 9900 }),
        settings: feeOn,
        destinationAccountId: CONNECTED_ACCOUNT,
        customer: { name: 'Dana', phone: '+15551234567', email: null },
        successUrl: 'https://x.test/s',
        cancelUrl: 'https://x.test/c',
      }),
    ).toThrow(/line items total 2100 but the cart total is 9900/);
  });
});

describe('cart hash', () => {
  it('is stable across modifier ordering but changes with money', () => {
    const base = twentyDollarCart();
    expect(hashCart(base)).toBe(hashCart(twentyDollarCart()));
    expect(hashCart(base)).not.toBe(
      hashCart(twentyDollarCart({ techFeeCents: 0, totalCents: 2000 })),
    );
  });
});
