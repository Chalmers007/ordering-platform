import { describe, expect, it } from 'vitest';
import { deliveryDisplay } from './delivery-display';

describe('owner delivery state display', () => {
  it('reports only persisted assignment information', () => {
    expect(deliveryDisplay(null)).toEqual({ label: 'Handoff pending', detail: null });
    expect(
      deliveryDisplay({ status: 'assigned', courier_name: 'Sam', estimated_delivery_at: null }),
    ).toEqual({ label: 'Courier assigned', detail: 'Assigned to Sam' });
  });

  it('shows a neutral delay state without inventing a courier', () => {
    expect(
      deliveryDisplay({ status: 'failed', courier_name: null, estimated_delivery_at: null }),
    ).toEqual({ label: 'Delivery delayed', detail: null });
  });
});
