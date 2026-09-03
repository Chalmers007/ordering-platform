import type { DeliveryStatus } from '@/types/database';

/**
 * The exact, allow-listed shape the tracking endpoint returns.
 *
 * Built field by field on purpose. Spreading a database row here would mean
 * that adding a column to `deliveries` later — say a second provider
 * reference — silently starts publishing it to every customer.
 */
export type TrackedItem = {
  name: string;
  quantity: number;
  lineTotalCents: number;
  notes: string | null;
  modifiers: string[];
};

export type TrackingResponse = {
  status: DeliveryStatus | null;
  driver_name: string | null;
  driver_phone: string | null;
  location: { lat: number; lng: number } | null;
  estimated_eta: string | null;
  /**
   * A courier-hosted tracking page, when one exists.
   *
   * Deliberately the ONE place the dispatch provider becomes visible to a
   * customer — everything else about the courier is hidden. Render it only
   * where a tenant has opted into showing it.
   */
  courier_tracking_url: string | null;
  order: {
    number: string;
    status: string;
    fulfillment_type: string;
    promised_at: string | null;
    placed_at: string | null;
    completed_at: string | null;
    customer_name: string;
    items: TrackedItem[];
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    tip_cents: number;
    delivery_fee_cents: number;
    service_fee_cents: number;
    tech_fee_cents: number;
    total_cents: number;
    currency: string;
  };
};

/** What `get_delivery_tracking()` returns, narrowed to what we read. */
export type TrackingRow = {
  order_id: string;
  order_number: string;
  order_status: string;
  fulfillment_type: string;
  promised_at: string | null;
  placed_at: string | null;
  completed_at: string | null;
  customer_name: string;
  items: unknown;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  tech_fee_cents: number;
  total_cents: number;
  currency: string;
  delivery_status: DeliveryStatus | null;
  driver_name: string | null;
  driver_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  estimated_delivery_at: string | null;
  courier_tracking_url: string | null;
};

export function toTrackingResponse(row: TrackingRow): TrackingResponse {
  const hasLocation = typeof row.latitude === 'number' && typeof row.longitude === 'number';

  return {
    status: row.delivery_status,
    driver_name: row.driver_name,
    driver_phone: row.driver_phone,
    location: hasLocation ? { lat: row.latitude as number, lng: row.longitude as number } : null,
    estimated_eta: row.estimated_delivery_at,
    courier_tracking_url: row.courier_tracking_url,
    order: {
      number: row.order_number,
      status: row.order_status,
      fulfillment_type: row.fulfillment_type,
      promised_at: row.promised_at,
      placed_at: row.placed_at,
      completed_at: row.completed_at,
      customer_name: row.customer_name,
      items: Array.isArray(row.items) ? (row.items as TrackedItem[]) : [],
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      tip_cents: row.tip_cents,
      delivery_fee_cents: row.delivery_fee_cents,
      service_fee_cents: row.service_fee_cents,
      tech_fee_cents: row.tech_fee_cents,
      total_cents: row.total_cents,
      currency: row.currency,
    },
  };
}
