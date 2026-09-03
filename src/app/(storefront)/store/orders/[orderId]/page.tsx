import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { createClientForRequest } from '@/lib/supabase/server';
import { TrackingView } from '@/components/storefront/tracking-view';
import { AccountUpsellModal } from '@/components/storefront/account-upsell-modal';
import { toTrackingResponse, type TrackingRow } from '@/lib/dispatch/tracking-response';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Order tracking.
 *
 * `[orderId]` is either the order id — for the signed-in customer who
 * placed it — or the order's opaque tracking token, for the same person
 * opening the link from a text on another device. Both are uuids, so it
 * cannot be decided by shape; get_delivery_tracking() decides, and refuses
 * both if neither authorises.
 *
 * Rendered server-side first so the page is useful before any JavaScript
 * runs; the client component then keeps it live.
 */
export default async function OrderTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ orderId }, { status }] = await Promise.all([params, searchParams]);
  const tenant = await getTenantContext();
  if (!tenant || !UUID.test(orderId)) notFound();

  const supabase = await createClientForRequest();

  const asOrder = await supabase.rpc('get_delivery_tracking', { p_order_id: orderId });
  const row =
    asOrder.data?.[0] ??
    (await supabase.rpc('get_delivery_tracking', { p_token: orderId })).data?.[0];

  if (!row) notFound();

  const isOwnOrder = Boolean(asOrder.data?.[0]);

  // Shaped through the same allow-list the API uses, so the server render
  // and the polled updates can never disagree about what a customer sees.
  const initial = toTrackingResponse(row as unknown as TrackingRow);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const showUpsell = status === 'success' && isOwnOrder && Boolean(user) && !user?.email;

  return (
    <>
      <TrackingView
        orderId={isOwnOrder ? row.order_id : null}
        token={isOwnOrder ? null : orderId}
        initial={initial}
      />
      {showUpsell ? (
        <AccountUpsellModal
          tenantId={tenant.tenantId}
          orderId={row.order_id}
          rewardCents={500}
          currency={row.currency}
        />
      ) : null}
    </>
  );
}
