'use client';

import { Bike, Clock, Printer, ShoppingBag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { primaryActionFor, urgencyFor, waitingMinutes } from '@/lib/kds/board';
import { deliveryDisplay } from '@/lib/kds/delivery-display';
import type { OrderWithDetails } from '@/types/database';

/**
 * One ticket.
 *
 * Designed to be read at arm's length across a hot pass: large order number,
 * quantities before names, modifiers indented, and special instructions in
 * a colour nothing else uses. Touch targets are finger-sized because the
 * person tapping is wearing gloves.
 */
export function OrderTicket({
  order,
  now,
  busy,
  onAdvance,
  onCancel,
  onPrepTime,
  onPrint,
}: {
  order: OrderWithDetails;
  now: number;
  busy: boolean;
  onAdvance: (order: OrderWithDetails, to: string) => void;
  onCancel: (order: OrderWithDetails) => void;
  onPrepTime: (order: OrderWithDetails) => void;
  onPrint: (order: OrderWithDetails) => void;
}) {
  const action = primaryActionFor(order);
  const urgency = urgencyFor(order, now);
  const waited = waitingMinutes(order, now);
  const delivery = order.fulfillment_type === 'delivery' ? deliveryDisplay(order.deliveries) : null;

  const edge =
    urgency === 'late'
      ? 'border-red-500'
      : urgency === 'due'
        ? 'border-amber-400'
        : 'border-neutral-700';

  return (
    <article
      className={`rounded-xl border-2 ${edge} bg-neutral-800 text-neutral-100 shadow-lg`}
      aria-label={`Order ${order.order_number}`}
    >
      <header className="flex items-start gap-2 border-b border-neutral-700 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold leading-none tabular-nums">
            #{order.order_number.split('-').pop()}
          </p>
          <p className="mt-1 truncate text-sm text-neutral-300">{order.customer_name}</p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              order.fulfillment_type === 'delivery'
                ? 'bg-sky-500/20 text-sky-300'
                : 'bg-violet-500/20 text-violet-300'
            }`}
          >
            {order.fulfillment_type === 'delivery' ? (
              <Bike className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
            )}
            {order.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup'}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${
              urgency === 'late'
                ? 'text-red-400'
                : urgency === 'due'
                  ? 'text-amber-300'
                  : 'text-neutral-400'
            }`}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {waited}m
          </span>
        </div>
      </header>

      <div className="border-b border-neutral-700/60 px-3 py-2 text-sm">
        {delivery ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-sky-200">Delivery: {delivery.label}</span>
            {delivery.detail ? <span className="text-neutral-300">{delivery.detail}</span> : null}
            {order.delivery_address_line1 ? (
              <span className="w-full text-neutral-300">
                {order.delivery_address_line1}, {order.delivery_city}, {order.delivery_region} {order.delivery_postal_code}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="font-semibold text-violet-200">Pickup order</span>
        )}
      </div>

      <ul className="divide-y divide-neutral-700/60 px-3 py-2">
        {order.order_items.map((item) => (
          <li key={item.id} className="py-2">
            <p className="text-base font-semibold leading-snug">
              <span className="tabular-nums">{item.quantity}×</span> {item.name_snapshot}
            </p>
            {item.order_item_modifiers.length > 0 ? (
              <ul className="mt-0.5 pl-5 text-sm text-neutral-300">
                {item.order_item_modifiers.map((modifier) => (
                  <li key={modifier.id}>+ {modifier.name_snapshot}</li>
                ))}
              </ul>
            ) : null}
            {item.notes ? (
              <p className="mt-1 rounded bg-amber-500/15 px-2 py-1 text-sm font-semibold uppercase text-amber-300">
                {item.notes}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {order.notes ? (
        <p className="mx-3 mb-2 rounded bg-amber-500/15 px-2 py-1 text-sm font-semibold text-amber-300">
          {order.notes}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 border-t border-neutral-700 px-3 py-2.5">
        {action ? (
          <Button
            className="h-12 flex-1 text-base"
            variant={action.tone === 'accent' ? 'accent' : 'primary'}
            loading={busy}
            onClick={() => onAdvance(order, action.to)}
          >
            {action.label}
          </Button>
        ) : null}

        <Button
          variant="ghost"
          className="h-12 px-3 text-sm text-neutral-300 hover:bg-neutral-700"
          aria-label={`Set prep time for order ${order.order_number}`}
          onClick={() => onPrepTime(order)}
          disabled={busy}
        >
          Set prep time
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 text-neutral-300 hover:bg-neutral-700"
          aria-label={`Print ticket for order ${order.order_number}`}
          onClick={() => onPrint(order)}
        >
          <Printer className="h-5 w-5" />
        </Button>

        <Button
          variant="ghost"
          className="h-12 px-3 text-neutral-400 hover:bg-red-900/40 hover:text-red-300"
          aria-label={`${order.status === 'paid' || order.status === 'confirmed' ? 'Reject' : 'Cancel'} order ${order.order_number}`}
          onClick={() => onCancel(order)}
        >
          <X className="h-5 w-5" />
          <span>{order.status === 'paid' || order.status === 'confirmed' ? 'Decline' : 'Cancel'}</span>
        </Button>
      </footer>
    </article>
  );
}
