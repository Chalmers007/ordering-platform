'use client';

import { useCallback, useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { OrderProgress } from './order-progress';
import { DriverMap } from './driver-map';
import type { FulfillmentType, OrderStatus } from '@/types/database';
import type { TrackingResponse } from '@/app/api/dispatch/track/route';

/**
 * Live order tracking.
 *
 * Two sources, because they answer different questions:
 *
 *  - Realtime on `orders` tells us the moment the kitchen moves the order.
 *    It only works for a signed-in owner, since the subscription runs under
 *    that customer's RLS.
 *  - Polling /api/dispatch/track is what moves the courier pin: those
 *    coordinates originate at the provider, and the proxy is the only thing
 *    allowed to ask for them. It is also the fallback for someone opening a
 *    tracking link on a device where they are not signed in.
 */
const POLL_MS = 15_000;

export function TrackingView({
  orderId,
  token,
  initial,
}: {
  orderId: string | null;
  token: string | null;
  initial: TrackingResponse;
}) {
  const [tracking, setTracking] = useState<TrackingResponse>(initial);

  const query = orderId ? `orderId=${orderId}` : `token=${token}`;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/dispatch/track?${query}`, { cache: 'no-store' });
      if (!response.ok) return;
      setTracking((await response.json()) as TrackingResponse);
    } catch {
      // Keep showing the last known state rather than blanking the page.
    }
  }, [query]);

  // Realtime status, for a signed-in owner.
  useEffect(() => {
    if (!orderId) return;
    const supabase = getSupabaseBrowserClient();

    // The socket carries its own token; without this it authenticates as
    // `anon` and RLS on `orders` drops every event for this customer.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    const channel = supabase
      .channel(`track:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deliveries',
          filter: `order_id=eq.${orderId}`,
        },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderId, refresh]);

  // Poll while the order is still moving. Terminal orders stop polling.
  const settled = ['completed', 'cancelled', 'refunded'].includes(tracking.order.status);
  useEffect(() => {
    if (settled) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [settled, refresh]);

  const showMap =
    tracking.order.status === 'out_for_delivery' && tracking.location !== null;

  const eta = tracking.estimated_eta ?? tracking.order.promised_at;

  return (
    <div className="space-y-5 py-4">
      <div>
        <p className="text-sm text-neutral-500">Order {tracking.order.number}</p>
        {eta && !settled ? (
          <p suppressHydrationWarning className="mt-0.5 text-lg font-semibold">
            {tracking.order.fulfillment_type === 'delivery' ? 'Arriving' : 'Ready'} around{' '}
            {new Date(eta).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        ) : null}
      </div>

      <OrderProgress
        status={tracking.order.status as OrderStatus}
        fulfillmentType={tracking.order.fulfillment_type as FulfillmentType}
      />

      {showMap && tracking.location ? (
        <div className="space-y-3">
          <DriverMap
            lat={tracking.location.lat}
            lng={tracking.location.lng}
            label={tracking.driver_name ?? 'Your driver'}
          />
          {tracking.driver_name ? (
            <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4">
              <div>
                <p className="font-medium">{tracking.driver_name}</p>
                <p className="text-sm text-neutral-600">On the way to you</p>
              </div>
              {tracking.driver_phone ? (
                <a
                  href={`tel:${tracking.driver_phone}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  Call
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tracking.order.status === 'out_for_delivery' && !tracking.location ? (
        <p className="rounded-xl bg-neutral-100 px-4 py-3 text-sm text-neutral-600">
          Your order is on its way. The driver&apos;s location will appear here shortly.
        </p>
      ) : null}
    </div>
  );
}
