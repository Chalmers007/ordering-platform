import type { DeliveryStatus } from '@/types/database';

/**
 * The exact, allow-listed shape the tracking endpoint returns.
 *
 * Built field by field on purpose. Spreading a database row here would mean
 * that adding a column to `deliveries` later — say a second provider
 * reference — silently starts publishing it to every customer.
 */
export type TrackingResponse = {
  status: DeliveryStatus | null;
  driver_name: string | null;
  driver_phone: string | null;
  location: { lat: number; lng: number } | null;
  estimated_eta: string | null;
  order: {
    number: string;
    status: string;
    fulfillment_type: string;
    promised_at: string | null;
    placed_at: string | null;
    completed_at: string | null;
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
  delivery_status: DeliveryStatus | null;
  driver_name: string | null;
  driver_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  estimated_delivery_at: string | null;
};

export function toTrackingResponse(row: TrackingRow): TrackingResponse {
  const hasLocation = typeof row.latitude === 'number' && typeof row.longitude === 'number';

  return {
    status: row.delivery_status,
    driver_name: row.driver_name,
    driver_phone: row.driver_phone,
    location: hasLocation ? { lat: row.latitude as number, lng: row.longitude as number } : null,
    estimated_eta: row.estimated_delivery_at,
    order: {
      number: row.order_number,
      status: row.order_status,
      fulfillment_type: row.fulfillment_type,
      promised_at: row.promised_at,
      placed_at: row.placed_at,
      completed_at: row.completed_at,
    },
  };
}
