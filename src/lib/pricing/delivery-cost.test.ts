import { describe, expect, it } from 'vitest';
import { allocateDeliveryFee } from './delivery-cost';

describe('delivery cost allocation', () => {
  it('supports restaurant and customer paid delivery', () => {
    expect(allocateDeliveryFee(499, 'restaurant')).toEqual({ customerCents: 0, restaurantCents: 499 });
    expect(allocateDeliveryFee(499, 'customer')).toEqual({ customerCents: 499, restaurantCents: 0 });
  });

  it('rounds a chosen split in cents without double-counting', () => {
    const allocation = allocateDeliveryFee(499, 'split', 50);
    expect(allocation).toEqual({ customerCents: 250, restaurantCents: 249 });
    expect(allocation.customerCents + allocation.restaurantCents).toBe(499);
  });
});
