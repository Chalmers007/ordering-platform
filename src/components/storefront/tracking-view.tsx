'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Phone } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { OrderProgress } from './order-progress';
import { DriverMap } from './driver-map';
import { formatCents } from '@/lib/money';
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

      {/*
        A courier-hosted page is the one place the dispatch provider becomes
        visible to a customer, so it is a plain secondary link rather than
        the primary way to follow the order — the map above is ours.
      */}
      {tracking.courier_tracking_url && !settled ? (
        <a
          href={tracking.courier_tracking_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-600 underline underline-offset-2"
        >
          Track with the courier
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      ) : null}

      {/* ---- what they ordered ---- */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="font-semibold">
          {tracking.order.fulfillment_type === 'delivery' ? 'Delivering' : 'For pickup'} ·{' '}
          {tracking.order.customer_name}
        </h2>

        <ul className="mt-3 divide-y divide-neutral-100">
          {tracking.order.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex gap-3 py-2">
              <span className="tabular-nums text-neutral-500">{item.quantity}&times;</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.name}</p>
                {item.modifiers.length > 0 ? (
                  <p className="text-sm text-neutral-500">{item.modifiers.join(', ')}</p>
                ) : null}
                {item.notes ? (
                  <p className="text-sm italic text-neutral-500">{item.notes}</p>
                ) : null}
              </div>
              <span className="tabular-nums text-neutral-700">
                {formatCents(item.lineTotalCents, tracking.order.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1 border-t border-neutral-200 pt-3 text-sm">
          <Row label="Subtotal" value={formatCents(tracking.order.subtotal_cents, tracking.order.currency)} />
          {tracking.order.discount_cents > 0 ? (
            <Row label="Discount" value={`-${formatCents(tracking.order.discount_cents, tracking.order.currency)}`} />
          ) : null}
          {tracking.order.delivery_fee_cents > 0 ? (
            <Row label="Delivery" value={formatCents(tracking.order.delivery_fee_cents, tracking.order.currency)} />
          ) : null}
          {tracking.order.service_fee_cents > 0 ? (
            <Row label="Service fee" value={formatCents(tracking.order.service_fee_cents, tracking.order.currency)} />
          ) : null}
          {tracking.order.tech_fee_cents > 0 ? (
            <Row label="Technology fee" value={formatCents(tracking.order.tech_fee_cents, tracking.order.currency)} />
          ) : null}
          {tracking.order.tax_cents > 0 ? (
            <Row label="Tax" value={formatCents(tracking.order.tax_cents, tracking.order.currency)} />
          ) : null}
          {tracking.order.tip_cents > 0 ? (
            <Row label="Tip" value={formatCents(tracking.order.tip_cents, tracking.order.currency)} />
          ) : null}
          <Row label="Total" value={formatCents(tracking.order.total_cents, tracking.order.currency)} emphasis />
        </dl>
      </section>
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`flex justify-between ${emphasis ? 'pt-1.5 text-base font-semibold' : ''}`}>
      <dt className={emphasis ? '' : 'text-neutral-600'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
