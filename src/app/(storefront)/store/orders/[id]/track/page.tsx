import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { createClientForRequest } from '@/lib/supabase/server';
import { TrackingView } from '@/components/storefront/tracking-view';
import { AccountUpsellModal } from '@/components/storefront/account-upsell-modal';
import type { TrackingResponse } from '@/app/api/dispatch/track/route';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Order tracking.
 *
 * `[id]` is either the order id — for the signed-in customer who placed it —
 * or the order's opaque tracking token, for the same person opening the link
 * from a text message on another device. `get_delivery_tracking()` decides
 * which, and refuses both if neither authorises.
 *
 * The first render is server-side so the page is useful before any JavaScript
 * runs; the client component then keeps it live.
 */
export default async function TrackOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ id }, { status }] = await Promise.all([params, searchParams]);
  const tenant = await getTenantContext();
  if (!tenant || !UUID.test(id)) notFound();

  const supabase = await createClientForRequest();

  // Try the id as an order first; a token is the fallback. Both are uuids, so
  // this cannot be decided by shape.
  const asOrder = await supabase.rpc('get_delivery_tracking', { p_order_id: id });
  const row =
    asOrder.data?.[0] ??
    (await supabase.rpc('get_delivery_tracking', { p_token: id })).data?.[0];

  if (!row) notFound();

  const isOwnOrder = Boolean(asOrder.data?.[0]);

  const initial: TrackingResponse = {
    status: row.delivery_status,
    driver_name: row.driver_name,
    driver_phone: row.driver_phone,
    location:
      typeof row.latitude === 'number' && typeof row.longitude === 'number'
        ? { lat: row.latitude, lng: row.longitude }
        : null,
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

  // The upsell is offered once, straight after a successful checkout, and
  // only to the customer whose order this is.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const showUpsell =
    status === 'success' && isOwnOrder && Boolean(user) && !user?.email;

  return (
    <>
      <TrackingView
        orderId={isOwnOrder ? row.order_id : null}
        token={isOwnOrder ? null : id}
        initial={initial}
      />
      {showUpsell ? (
        <AccountUpsellModal
          tenantId={tenant.tenantId}
          orderId={row.order_id}
          rewardCents={500}
          currency="USD"
        />
      ) : null}
    </>
  );
}
