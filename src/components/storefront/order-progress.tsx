'use client';

import { Check, ChefHat, Package, Truck } from 'lucide-react';
import type { FulfillmentType, OrderStatus } from '@/types/database';

/**
 * Received -> Preparing -> Out for delivery -> Completed.
 *
 * A cancelled or refunded order is not a stage on this track, so it renders
 * as its own state rather than a bar frozen somewhere misleading.
 */
const STEPS = [
  { key: 'received', label: 'Received', icon: Check },
  { key: 'preparing', label: 'Preparing', icon: ChefHat },
  { key: 'transit', label: 'Out for delivery', icon: Truck },
  { key: 'completed', label: 'Completed', icon: Package },
] as const;

function stageIndex(status: OrderStatus): number {
  switch (status) {
    case 'paid':
      return 0;
    case 'confirmed':
    case 'preparing':
      return 1;
    case 'ready':
    case 'out_for_delivery':
      return 2;
    case 'completed':
      return 3;
    default:
      return 0;
  }
}

export function OrderProgress({
  status,
  fulfillmentType,
}: {
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
}) {
  if (status === 'cancelled' || status === 'refunded') {
    return (
      <p role="status" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
        This order was {status}.
      </p>
    );
  }

  const current = stageIndex(status);
  const steps = STEPS.map((step) =>
    step.key === 'transit' && fulfillmentType === 'pickup'
      ? { ...step, label: 'Ready for pickup' }
      : step,
  );

  return (
    <ol
      className="flex items-start gap-1"
      aria-label="Order progress"
      role="list"
    >
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const Icon = step.icon;

        return (
          <li key={step.key} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full items-center gap-1">
              <span
                className={`h-1 flex-1 rounded-full ${index === 0 ? 'invisible' : done || active ? 'bg-[var(--brand-primary)]' : 'bg-neutral-200'}`}
                aria-hidden
              />
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${
                  done
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                    : active
                      ? 'border-[var(--brand-primary)] bg-white text-[var(--brand-primary)]'
                      : 'border-neutral-200 bg-white text-neutral-300'
                }`}
                aria-hidden
              >
                <Icon className="h-4 w-4" />
              </span>
              <span
                className={`h-1 flex-1 rounded-full ${index === steps.length - 1 ? 'invisible' : done ? 'bg-[var(--brand-primary)]' : 'bg-neutral-200'}`}
                aria-hidden
              />
            </div>
            <span
              className={`text-center text-xs ${active ? 'font-semibold text-neutral-900' : 'text-neutral-500'}`}
              aria-current={active ? 'step' : undefined}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
