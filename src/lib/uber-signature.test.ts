import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyUberSignature } from './uber-signature';
import { mapUberStatus, quoteFeeCents } from './uber-status';

const SECRET = 'uber-webhook-signing-secret';
const BODY = JSON.stringify({
  event_id: 'evt_1',
  event_type: 'event.delivery_status',
  data: { id: 'del_abc', status: 'pickup_complete' },
});

const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('uber webhook signatures', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyUberSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a body altered after signing', () => {
    // The whole point: an attacker must not be able to claim an order was
    // delivered by editing the payload.
    const signature = sign(BODY);
    const tampered = BODY.replace('pickup_complete', 'delivered');
    expect(verifyUberSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyUberSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing or empty signature', () => {
    expect(verifyUberSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyUberSignature(BODY, '', SECRET)).toBe(false);
  });

  it('rejects rather than throwing on a malformed signature', () => {
    // timingSafeEqual throws on a length mismatch; a forged header must
    // produce a 401, not a 500.
    expect(() => verifyUberSignature(BODY, 'not-hex', SECRET)).not.toThrow();
    expect(verifyUberSignature(BODY, 'not-hex', SECRET)).toBe(false);
    expect(verifyUberSignature(BODY, 'zz'.repeat(32), SECRET)).toBe(false);
  });

  it('refuses to verify when no secret is configured', () => {
    expect(verifyUberSignature(BODY, sign(BODY), '')).toBe(false);
  });

  it('is case-insensitive about the hex digest', () => {
    expect(verifyUberSignature(BODY, sign(BODY).toUpperCase(), SECRET)).toBe(true);
  });
});

describe('uber status mapping', () => {
  it('maps the documented lifecycle onto our vocabulary', () => {
    expect(mapUberStatus('pending')).toBe('assigned');
    expect(mapUberStatus('pickup')).toBe('assigned');
    expect(mapUberStatus('pickup_complete')).toBe('picked_up');
    expect(mapUberStatus('dropoff')).toBe('en_route');
    expect(mapUberStatus('delivered')).toBe('delivered');
    expect(mapUberStatus('canceled')).toBe('cancelled');
    expect(mapUberStatus('returned')).toBe('failed');
  });

  it('returns null for anything it does not recognise', () => {
    // Guessing here would close an order that is still out for delivery.
    expect(mapUberStatus('something_new')).toBeNull();
    expect(mapUberStatus('')).toBeNull();
    expect(mapUberStatus(null)).toBeNull();
    expect(mapUberStatus(undefined)).toBeNull();
  });

  it('never maps an unknown status onto a terminal one', () => {
    for (const unknown of ['in_progress', 'assigned_to_courier', 'weird']) {
      expect(['delivered', 'cancelled', 'failed']).not.toContain(mapUberStatus(unknown));
    }
  });
});

describe('quote fees', () => {
  it('treats the fee as integer cents', () => {
    expect(quoteFeeCents({ fee: 799 })).toBe(799);
    // A fractional cent from the courier must not become a float in a
    // money column.
    expect(quoteFeeCents({ fee: 799.4 })).toBe(799);
  });
});
