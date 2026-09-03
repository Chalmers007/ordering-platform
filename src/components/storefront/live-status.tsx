'use client';

import type { FulfillmentType, OrderStatus } from '@/types/database';

/**
 * The one-line answer to "what is happening to my food right now".
 *
 * The stage track below it shows the whole journey; this says where the
 * order is at a glance, and its dot pulses only while the order is still
 * moving. A pulse that never stops reads as a loading spinner nobody
 * cancelled — so a settled order gets a still dot, which is also the
 * clearest signal that nothing further is coming.
 *
 * Colours are semantic rather than the tenant's brand. A pulsing dot in a
 * restaurant's own red would read as an error at exactly the moment we are
 * telling someone their food is on its way; the map pin carries the brand
 * instead, where a colour means "us" rather than "state".
 */

type Tone = 'progress' | 'transit' | 'done' | 'failed';

const TONES: Record<Tone, { dot: string; halo: string; text: string }> = {
  progress: { dot: 'bg-amber-500', halo: 'bg-amber-400', text: 'text-amber-700' },
  transit: { dot: 'bg-emerald-500', halo: 'bg-emerald-400', text: 'text-emerald-700' },
  done: { dot: 'bg-neutral-400', halo: 'bg-neutral-300', text: 'text-neutral-600' },
  failed: { dot: 'bg-red-500', halo: 'bg-red-400', text: 'text-red-700' },
};

function describe(
  status: OrderStatus,
  fulfillmentType: FulfillmentType,
): { label: string; tone: Tone; live: boolean } | null {
  const delivery = fulfillmentType === 'delivery';

  switch (status) {
    case 'paid':
      return { label: 'Order received', tone: 'progress', live: true };
    case 'confirmed':
    case 'preparing':
      return { label: 'Being prepared', tone: 'progress', live: true };
    case 'ready':
      return delivery
        ? { label: 'Waiting for the driver', tone: 'progress', live: true }
        : { label: 'Ready for pickup', tone: 'transit', live: true };
    case 'out_for_delivery':
      return { label: 'On the way', tone: 'transit', live: true };
    case 'completed':
      return delivery
        ? { label: 'Delivered', tone: 'done', live: false }
        : { label: 'Picked up', tone: 'done', live: false };
    default:
      // cancelled and refunded are rendered by OrderProgress as their own
      // state; a second, quieter line would only soften it.
      return null;
  }
}

export function LiveStatus({
  status,
  fulfillmentType,
}: {
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
}) {
  const state = describe(status, fulfillmentType);
  if (!state) return null;

  const tone = TONES[state.tone];

  return (
    <p
      // Announced on change, so a screen reader hears "On the way" when the
      // driver collects the order rather than only on a fresh page load.
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-sm font-medium ${tone.text}`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        {state.live ? (
          <span
            // motion-reduce: a pulse is decoration here — the label already
            // carries the meaning — so it is dropped rather than replaced.
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${tone.halo}`}
          />
        ) : null}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone.dot}`} />
      </span>
      {state.label}
    </p>
  );
}
