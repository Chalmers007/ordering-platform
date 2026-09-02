import { describe, expect, it } from 'vitest';
import { renderTicket } from './ticket';
import { CMD } from './escpos';
import type { OrderWithDetails } from '@/types/database';

function order(patch: Partial<OrderWithDetails> = {}): OrderWithDetails {
  return {
    id: 'dddddddd-0000-0000-0000-000000000001',
    order_number: '260902-0042',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    status: 'paid',
    payment_status: 'paid',
    fulfillment_type: 'delivery',
    customer_name: 'Dana Q',
    customer_phone: '5551234567',
    currency: 'USD',
    subtotal_cents: 2000,
    discount_cents: 0,
    tax_cents: 175,
    tip_cents: 300,
    delivery_fee_cents: 499,
    service_fee_cents: 0,
    tech_fee_cents: 100,
    total_cents: 3074,
    delivery_address_line1: '12 Elm St',
    delivery_address_line2: null,
    delivery_city: 'Raleigh',
    delivery_region: 'NC',
    delivery_postal_code: '27601',
    delivery_instructions: 'Gate code 4417',
    notes: null,
    placed_at: '2026-09-02T17:30:00.000Z',
    created_at: '2026-09-02T17:30:00.000Z',
    promised_at: '2026-09-02T18:00:00.000Z',
    order_items: [
      {
        id: 'item-1',
        name_snapshot: 'Family Platter',
        quantity: 2,
        unit_price_cents: 1000,
        line_total_cents: 2000,
        notes: 'no onions',
        order_item_modifiers: [
          { id: 'mod-1', name_snapshot: 'Extra cheese', price_delta_cents: 150 },
        ],
      },
    ],
    ...patch,
  } as unknown as OrderWithDetails;
}

describe('kitchen ticket', () => {
  it('leads with the order number and fulfilment type', () => {
    const job = renderTicket(order(), { restaurantName: "Joe's Pizza" });
    const lines = job.preview.split('\n').filter(Boolean);

    expect(job.preview).toContain("Joe's Pizza");
    expect(job.preview).toContain('KITCHEN COPY');
    expect(job.preview).toContain('#260902-0042');
    expect(job.preview).toContain('** DELIVERY **');
    // The order number must be near the top, not buried under addresses.
    expect(lines.findIndex((l) => l.includes('#260902-0042'))).toBeLessThan(4);
  });

  it('prints quantities, modifiers, and special instructions', () => {
    const job = renderTicket(order(), { restaurantName: "Joe's Pizza" });

    expect(job.preview).toContain('2x Family Platter');
    expect(job.preview).toContain('+ Extra cheese');
    // Instructions are upper-cased so a line cook cannot skim past them.
    expect(job.preview).toContain('** NO ONIONS');
  });

  it('omits prices on the kitchen copy and shows them on the customer copy', () => {
    const kitchen = renderTicket(order(), { restaurantName: 'X' });
    expect(kitchen.preview).not.toContain('$30.74');

    const customer = renderTicket(order(), { restaurantName: 'X', variant: 'customer' });
    expect(customer.preview).toContain('$30.74');
    expect(customer.preview).toContain('Technology fee');
    expect(customer.preview).toContain('$1.00');
    expect(customer.preview).toContain('PAID');
  });

  it('prints the delivery address for a delivery, not for a pickup', () => {
    const delivery = renderTicket(order(), { restaurantName: 'X' });
    expect(delivery.preview).toContain('DELIVER TO');
    expect(delivery.preview).toContain('12 Elm St');
    expect(delivery.preview).toContain('Gate code 4417');

    const pickup = renderTicket(
      order({ fulfillment_type: 'pickup' }),
      { restaurantName: 'X' },
    );
    expect(pickup.preview).toContain('** PICKUP **');
    expect(pickup.preview).not.toContain('DELIVER TO');
  });

  it('ends with a cut and no drawer kick by default', () => {
    const job = renderTicket(order(), { restaurantName: 'X' });
    const bytes = Array.from(job.bytes).join(',');

    expect(bytes).toContain(CMD.CUT_FULL.join(','));
    expect(bytes).not.toContain(CMD.DRAWER_KICK.join(','));
  });

  it('kicks the drawer when asked', () => {
    const job = renderTicket(order(), { restaurantName: 'X', kickDrawer: true });
    expect(Array.from(job.bytes).join(',')).toContain(CMD.DRAWER_KICK.join(','));
  });

  it('fits 58mm paper without overflowing any line', () => {
    const job = renderTicket(order(), { restaurantName: 'X', columns: 32, variant: 'customer' });
    for (const line of job.preview.split('\n')) {
      expect(line.length, `"${line}" overflows 32 columns`).toBeLessThanOrEqual(32);
    }
  });

  it('carries the order identity on the job', () => {
    const job = renderTicket(order(), { restaurantName: 'X' });
    expect(job.orderId).toBe('dddddddd-0000-0000-0000-000000000001');
    expect(job.orderNumber).toBe('260902-0042');
    expect(job.bytes).toBeInstanceOf(Uint8Array);
  });
});
