import { describe, expect, it } from 'vitest';
import { fulfillmentStatus } from './fulfillment';

describe('KDS fulfilment state', () => {
  it('shows each enabled mode', () => {
    expect(fulfillmentStatus({ accepts_pickup: true, accepts_delivery: true })).toBe(
      'Accepting Pickup + Delivery',
    );
    expect(fulfillmentStatus({ accepts_pickup: true, accepts_delivery: false })).toBe(
      'Accepting Pickup',
    );
  });

  it('handles an unavailable state defensively', () => {
    expect(fulfillmentStatus({ accepts_pickup: false, accepts_delivery: false })).toBe(
      'No fulfilment available',
    );
  });
});
