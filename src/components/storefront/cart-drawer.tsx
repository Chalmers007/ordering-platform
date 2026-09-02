'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart/cart-context';
import { validateCart } from '@/lib/cart/validate';
import { formatCents } from '@/lib/money';
import type { PricedCart } from '@/types/database';

/**
 * The cart.
 *
 * It shows no prices of its own. Every figure here comes from
 * /api/cart/validate -> price_cart(), re-requested whenever the cart changes.
 * When validation fails — an item went unavailable, the kitchen paused, the
 * delivery minimum is not met — checkout is blocked and the reason is the
 * database's own message.
 */
export function CartDrawer({
  open,
  onOpenChange,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const { cart, itemCount, setQuantity, removeLine, hydrated } = useCart();
  const router = useRouter();

  const [priced, setPriced] = useState<PricedCart | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);

  // Re-price on every change while the drawer is open. The dependency is the
  // serialised cart, so a quantity bump re-validates but a re-render does not.
  const cartSignature = JSON.stringify({
    f: cart.fulfillmentType,
    t: cart.tipCents,
    l: cart.lines,
  });

  useEffect(() => {
    if (!open || !hydrated) return;

    if (cart.lines.length === 0) {
      setPriced(null);
      setPricingError(null);
      return;
    }

    let cancelled = false;
    setPricing(true);

    void validateCart(cart).then((result) => {
      if (cancelled) return;
      setPricing(false);
      if (result.ok) {
        setPriced(result.pricedCart);
        setPricingError(null);
      } else {
        setPriced(null);
        setPricingError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hydrated, cartSignature]);

  const canCheckout = Boolean(priced) && !pricing && !pricingError && itemCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-5">
          <DialogTitle className="pr-8 text-lg font-semibold">Your order</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-neutral-600">
            {itemCount === 0
              ? 'Your cart is empty.'
              : `${itemCount} item${itemCount === 1 ? '' : 's'} · ${cart.fulfillmentType}`}
          </DialogDescription>

          {cart.lines.length > 0 ? (
            <ul className="mt-4 divide-y divide-neutral-200">
              {cart.lines.map((line) => {
                // Names and prices come from the priced response, never from
                // anything the browser stored.
                const pricedLine = priced?.lines.find((l) => l.lineId === line.lineId);

                return (
                  <li key={line.lineId} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {pricedLine?.name ?? <span className="text-neutral-400">Loading…</span>}
                      </p>
                      {pricedLine?.modifiers.length ? (
                        <p className="mt-0.5 text-sm text-neutral-600">
                          {pricedLine.modifiers.map((m) => m.name).join(', ')}
                        </p>
                      ) : null}
                      {line.notes ? (
                        <p className="mt-0.5 text-sm italic text-neutral-500">{line.notes}</p>
                      ) : null}

                      <div className="mt-2 flex items-center gap-1 rounded-lg border border-neutral-300 px-1 w-fit">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Decrease quantity"
                          onClick={() => setQuantity(line.lineId, line.quantity - 1)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-7 text-center text-sm tabular-nums">{line.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Increase quantity"
                          onClick={() => setQuantity(line.lineId, line.quantity + 1)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {pricedLine ? formatCents(pricedLine.lineTotalCents, currency) : '—'}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove item"
                        onClick={() => removeLine(line.lineId)}
                      >
                        <Trash2 className="h-4 w-4 text-neutral-500" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {pricingError ? (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {pricingError}
            </p>
          ) : null}

          {priced ? (
            <dl className="mt-4 space-y-1.5 border-t border-neutral-200 pt-4 text-sm">
              <Row label="Subtotal" value={formatCents(priced.subtotalCents, currency)} />
              {priced.deliveryFeeCents > 0 ? (
                <Row label="Delivery" value={formatCents(priced.deliveryFeeCents, currency)} />
              ) : null}
              {priced.serviceFeeCents > 0 ? (
                <Row label="Service fee" value={formatCents(priced.serviceFeeCents, currency)} />
              ) : null}
              {priced.techFeeCents > 0 ? (
                <Row label="Technology fee" value={formatCents(priced.techFeeCents, currency)} />
              ) : null}
              {priced.taxCents > 0 ? (
                <Row label="Tax" value={formatCents(priced.taxCents, currency)} />
              ) : null}
              <Row
                label="Total"
                value={formatCents(priced.totalCents, currency)}
                emphasis
              />
            </dl>
          ) : null}
        </div>

        <div className="border-t border-neutral-200 bg-white px-5 py-4">
          <Button
            className="w-full"
            size="lg"
            loading={pricing}
            disabled={!canCheckout}
            onClick={() => {
              onOpenChange(false);
              router.push('/checkout');
            }}
          >
            {pricing
              ? 'Checking prices…'
              : priced
                ? `Checkout · ${formatCents(priced.totalCents, currency)}`
                : 'Checkout'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
