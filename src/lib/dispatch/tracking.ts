import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import type { DeliveryStatus, TableUpdate } from '@/types/database';

/**
 * Courier refresh.
 *
 * Nothing here is ever returned to a caller. The provider's identity, its
 * base URL, the tenant's API key and the job reference all stay inside this
 * module; what reaches a browser is the normalised row in `deliveries`.
 */

const DISPATCH_API_BASE_URL =
  process.env.DISPATCH_API_BASE_URL ?? 'https://api.shipday.com';
const SECRET_KEY = 'shipday_api_key';

/** How stale a courier location may be before we go and ask again. Polling
 *  the provider on every page poll would burn the tenant's rate limit. */
export const LOCATION_TTL_MS = 30_000;

/** Provider status vocabulary -> ours. An unrecognised value must not
 *  silently become 'delivered'. */
function normalizeStatus(raw: unknown): DeliveryStatus | null {
  const value = String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  switch (value) {
    case 'NOT_ASSIGNED':
    case 'NOT_ACCEPTED':
      return 'unassigned';
    case 'ACTIVE':
    case 'ASSIGNED':
    case 'ACCEPTED':
      return 'assigned';
    case 'PICKED_UP':
    case 'STARTED':
      return 'picked_up';
    case 'READY_TO_DELIVER':
    case 'ON_THE_WAY':
    case 'EN_ROUTE':
      return 'en_route';
    case 'ALREADY_DELIVERED':
    case 'DELIVERED':
      return 'delivered';
    case 'FAILED_DELIVERY':
    case 'FAILED':
      return 'failed';
    case 'INCOMPLETE':
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled';
    default:
      return null;
  }
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

type ProviderOrder = {
  orderStatus?: { orderState?: string };
  carrier?: {
    name?: string;
    phone?: string;
    photo?: string;
    lat?: number | string;
    lng?: number | string;
  };
  expectedDeliveryTime?: string;
  activityLog?: { expectedDeliveryTime?: string };
};

/**
 * Refresh one delivery from the courier, if it is worth refreshing.
 *
 * Returns whether anything changed. Failures are swallowed on purpose: a
 * tracking page must still render the last known position when the provider
 * is down, rather than erroring.
 */
export async function refreshCourierLocation(orderId: string): Promise<boolean> {
  const service = createServiceClient();

  const { data: delivery } = await service
    .from('deliveries')
    .select('tenant_id, external_ref, status, location_updated_at')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!delivery?.external_ref) return false;

  // Terminal states never move again.
  if (['delivered', 'failed', 'cancelled'].includes(delivery.status)) return false;

  const lastUpdate = delivery.location_updated_at
    ? new Date(delivery.location_updated_at).getTime()
    : 0;
  if (Date.now() - lastUpdate < LOCATION_TTL_MS) return false;

  const { data: secret } = await service
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', delivery.tenant_id)
    .eq('key', SECRET_KEY)
    .maybeSingle();

  if (!secret?.value) return false;

  let payload: ProviderOrder | null = null;
  try {
    const response = await fetch(
      `${DISPATCH_API_BASE_URL}/orders/${encodeURIComponent(delivery.external_ref)}`,
      {
        headers: { Authorization: `Basic ${secret.value}` },
        signal: AbortSignal.timeout(5_000),
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      console.error('courier tracking refresh rejected', response.status);
      return false;
    }
    const body = (await response.json()) as ProviderOrder | ProviderOrder[];
    payload = Array.isArray(body) ? (body[0] ?? null) : body;
  } catch (error) {
    console.error('courier tracking refresh failed', error);
    return false;
  }

  if (!payload) return false;

  const status = normalizeStatus(payload.orderStatus?.orderState);
  const lat = num(payload.carrier?.lat);
  const lng = num(payload.carrier?.lng);
  const eta = payload.expectedDeliveryTime ?? payload.activityLog?.expectedDeliveryTime ?? null;

  const patch: TableUpdate<'deliveries'> = { location_updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (payload.carrier?.name) patch.courier_name = payload.carrier.name;
  if (payload.carrier?.phone) patch.courier_phone = payload.carrier.phone;
  if (payload.carrier?.photo) patch.courier_photo_url = payload.carrier.photo;
  if (lat !== null) patch.courier_latitude = lat;
  if (lng !== null) patch.courier_longitude = lng;
  if (eta) patch.estimated_delivery_at = eta;
  if (status === 'picked_up') patch.picked_up_at = new Date().toISOString();
  if (status === 'delivered') patch.delivered_at = new Date().toISOString();

  const { error } = await service.from('deliveries').update(patch).eq('order_id', orderId);
  if (error) {
    console.error('could not persist courier refresh', error);
    return false;
  }

  return true;
}
