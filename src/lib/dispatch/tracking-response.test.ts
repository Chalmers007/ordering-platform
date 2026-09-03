import { describe, expect, it } from 'vitest';
import { toTrackingResponse, type TrackingRow } from './tracking-response';

/**
 * Objective: nothing about the courier vendor may reach a customer. These
 * tests treat the serialised response as the surface under test, so a future
 * field that leaks a provider name or key fails here rather than in
 * production.
 */

/** A row deliberately polluted with everything that must NOT escape. */
const pollutedRow = {
  order_id: '11111111-1111-1111-1111-111111111111',
  order_number: '260902-0007',
  order_status: 'out_for_delivery',
  fulfillment_type: 'delivery',
  promised_at: '2026-09-02T18:00:00.000Z',
  placed_at: '2026-09-02T17:30:00.000Z',
  completed_at: null,
  delivery_status: 'en_route',
  driver_name: 'Sam R.',
  driver_phone: '+15551239876',
  latitude: 35.7796,
  longitude: -78.6382,
  estimated_delivery_at: '2026-09-02T18:12:00.000Z',
  customer_name: 'Dana Q',
  items: [
    { name: 'Margherita', quantity: 2, lineTotalCents: 2800, notes: null, modifiers: ['Large'] },
  ],
  subtotal_cents: 2800,
  discount_cents: 0,
  tax_cents: 245,
  tip_cents: 400,
  delivery_fee_cents: 499,
  service_fee_cents: 0,
  tech_fee_cents: 100,
  total_cents: 4044,
  currency: 'USD',
  courier_tracking_url: 'https://track.shipday.com/abc123',

  // None of these are part of the response type; they stand in for columns
  // that exist on the row or could be added to it later.
  external_ref: 'shipday_job_98765',
  has_external_ref: true,
  provider: 'shipday',
  shipday_api_key: 'sk_live_courier_do_not_leak',
  courier_photo_url: 'https://api.shipday.com/photos/1.jpg',
  payment_intent_id: 'pi_live_123',
} as unknown as TrackingRow;

const VENDOR_TERMS = ['shipday', 'external_ref', 'api_key', 'apikey', 'provider', 'payment_intent'];

describe('tracking response shaping', () => {
  it('returns exactly the allow-listed keys', () => {
    const body = toTrackingResponse(pollutedRow);

    expect(Object.keys(body).sort()).toEqual([
      'courier_tracking_url',
      'driver_name',
      'driver_phone',
      'estimated_eta',
      'location',
      'order',
      'status',
    ]);
    expect(Object.keys(body.order).sort()).toEqual([
      'completed_at',
      'currency',
      'customer_name',
      'delivery_fee_cents',
      'discount_cents',
      'fulfillment_type',
      'items',
      'number',
      'placed_at',
      'promised_at',
      'service_fee_cents',
      'status',
      'subtotal_cents',
      'tax_cents',
      'tech_fee_cents',
      'tip_cents',
      'total_cents',
    ]);
  });

  it('leaks no vendor name, job reference, or credential', () => {
    const body = toTrackingResponse(pollutedRow);

    // courier_tracking_url is the ONE deliberate exception: a
    // courier-hosted page necessarily carries the courier's domain. It is
    // excluded here so the guard stays meaningful everywhere else rather
    // than being deleted the first time it fires.
    const { courier_tracking_url: _courierUrl, ...rest } = body;
    const serialised = JSON.stringify(rest).toLowerCase();

    for (const term of VENDOR_TERMS) {
      expect(serialised, `"${term}" must not appear in a client response`).not.toContain(term);
    }
    expect(serialised).not.toContain('shipday_job_98765');
    expect(serialised).not.toContain('sk_live_courier_do_not_leak');
  });

  it('carries the order itself, not just where the driver is', () => {
    const body = toTrackingResponse(pollutedRow);

    expect(body.order.items).toHaveLength(1);
    expect(body.order.items[0]).toMatchObject({ name: 'Margherita', quantity: 2 });
    expect(body.order.total_cents).toBe(4044);
    expect(body.order.customer_name).toBe('Dana Q');
  });

  it('reports no items rather than crashing when the aggregate is empty', () => {
    const empty = { ...pollutedRow, items: null } as unknown as TrackingRow;
    expect(toTrackingResponse(empty).order.items).toEqual([]);
  });

  it('still returns what the customer needs', () => {
    const body = toTrackingResponse(pollutedRow);

    expect(body.status).toBe('en_route');
    expect(body.driver_name).toBe('Sam R.');
    expect(body.driver_phone).toBe('+15551239876');
    expect(body.location).toEqual({ lat: 35.7796, lng: -78.6382 });
    expect(body.estimated_eta).toBe('2026-09-02T18:12:00.000Z');
    expect(body.order.number).toBe('260902-0007');
  });

  it('reports no location rather than a half one', () => {
    // A latitude with no longitude is not a position. Emitting {lat, lng:null}
    // would put the pin in the Gulf of Guinea.
    const partial = { ...pollutedRow, longitude: null } as unknown as TrackingRow;
    expect(toTrackingResponse(partial).location).toBeNull();
  });

  it('handles an order with no delivery record at all (pickup)', () => {
    const pickup = {
      ...pollutedRow,
      fulfillment_type: 'pickup',
      delivery_status: null,
      driver_name: null,
      driver_phone: null,
      latitude: null,
      longitude: null,
      estimated_delivery_at: null,
    } as unknown as TrackingRow;

    const body = toTrackingResponse(pickup);
    expect(body.status).toBeNull();
    expect(body.location).toBeNull();
    expect(body.order.fulfillment_type).toBe('pickup');
  });
});
