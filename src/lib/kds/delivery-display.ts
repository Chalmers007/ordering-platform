import type { Delivery } from '@/types/database';

export type DeliveryDisplay = {
  label: string;
  detail: string | null;
};

/** Map persisted dispatch state to neutral owner-facing language. */
export function deliveryDisplay(delivery: Pick<Delivery, 'status' | 'courier_name' | 'estimated_delivery_at'> | Pick<Delivery, 'status' | 'courier_name' | 'estimated_delivery_at'>[] | null): DeliveryDisplay {
  const row = Array.isArray(delivery) ? delivery[0] : delivery;
  if (!row) return { label: 'Handoff pending', detail: null };
  const status = row.status ?? 'unassigned';

  const labels: Record<Delivery['status'], string> = {
    unassigned: 'Awaiting assignment',
    assigned: 'Courier assigned',
    picked_up: 'Picked up by courier',
    en_route: 'On the way',
    delivered: 'Delivered',
    failed: 'Delivery delayed',
    cancelled: 'Delivery cancelled',
  };
  const detail = row.courier_name
    ? `Assigned to ${row.courier_name}`
    : row.estimated_delivery_at
      ? `Estimated ${new Date(row.estimated_delivery_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null;
  return { label: labels[status], detail };
}
