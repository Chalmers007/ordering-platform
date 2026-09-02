import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import {
  __setStripeForTesting,
  constructWebhookEvent,
  StripeSignatureError,
} from './stripe';

/**
 * Real signature verification — Stripe's own HMAC, not a mock. The SDK
 * computes these offline, so this exercises the exact code path a live
 * webhook takes without a network call or a real key.
 */

const WEBHOOK_SECRET = 'whsec_testsecretvalueforsigning';
const stripe = new Stripe('sk_test_notusedforsigning');

const payload = JSON.stringify({
  id: 'evt_test_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_1',
      object: 'checkout.session',
      payment_status: 'paid',
      metadata: { checkout_session_id: 'ccccdddd-0000-0000-0000-000000000001' },
    },
  },
});

function sign(body: string, secret = WEBHOOK_SECRET, timestamp?: number): string {
  return stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp });
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  __setStripeForTesting(stripe);
});

afterEach(() => {
  __setStripeForTesting(null);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe('constructWebhookEvent', () => {
  it('accepts a correctly signed payload', () => {
    const event = constructWebhookEvent(payload, sign(payload));
    expect(event.id).toBe('evt_test_1');
    expect(event.type).toBe('checkout.session.completed');
  });

  it('rejects a payload signed with the wrong secret', () => {
    expect(() => constructWebhookEvent(payload, sign(payload, 'whsec_attackerguess')))
      .toThrow(StripeSignatureError);
  });

  it('rejects a body that was altered after signing', () => {
    // The signature is over the exact bytes. Raising the total after signing
    // must not verify — this is why the route reads the body as text.
    const signature = sign(payload);
    const tampered = payload.replace('"paid"', '"unpaid"');
    expect(() => constructWebhookEvent(tampered, signature)).toThrow(StripeSignatureError);
  });

  it('rejects a missing signature header', () => {
    expect(() => constructWebhookEvent(payload, null)).toThrow(/Missing stripe-signature/);
  });

  it('rejects a replayed signature outside the tolerance window', () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    expect(() => constructWebhookEvent(payload, sign(payload, WEBHOOK_SECRET, stale)))
      .toThrow(StripeSignatureError);
  });

  it('fails loudly when the webhook secret is not configured', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => constructWebhookEvent(payload, sign(payload)))
      .toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
