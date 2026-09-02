'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { useCart } from '@/lib/cart/cart-context';
import { validateCart } from '@/lib/cart/validate';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatCents } from '@/lib/money';
import { PhoneVerification } from './phone-verification';
import type { PricedCart } from '@/types/database';

type DeliveryFields = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  instructions: string;
};

const EMPTY_DELIVERY: DeliveryFields = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  instructions: '',
};

export function CheckoutForm({
  currency,
  acceptsDelivery,
  defaultTipBps,
}: {
  currency: string;
  acceptsDelivery: boolean;
  defaultTipBps: number;
}) {
  const { cart, itemCount, setTip, hydrated } = useCart();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [delivery, setDelivery] = useState<DeliveryFields>(EMPTY_DELIVERY);
  const [priced, setPriced] = useState<PricedCart | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user?.phone) setPhone(data.user.phone);
      setAuthReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // Re-price whenever the cart or tip changes. This is the number the
  // customer is about to be charged, so it is never computed in the browser.
  const signature = JSON.stringify({ f: cart.fulfillmentType, t: cart.tipCents, l: cart.lines });
  useEffect(() => {
    if (!hydrated || cart.lines.length === 0) return;
    let cancelled = false;

    void validateCart(cart).then((result) => {
      if (cancelled) return;
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
  }, [hydrated, signature]);

  if (hydrated && itemCount === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-neutral-600">Your cart is empty.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/')}>
          Back to the menu
        </Button>
      </div>
    );
  }

  const isDelivery = cart.fulfillmentType === 'delivery' && acceptsDelivery;
  const deliveryComplete =
    !isDelivery ||
    Boolean(delivery.addressLine1.trim() && delivery.city.trim() && delivery.postalCode.trim());
  const canSubmit =
    Boolean(user) && Boolean(priced) && !pricingError && name.trim().length > 0 && deliveryComplete;

  async function submit() {
    if (!priced) return;
    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: {
            fulfillmentType: cart.fulfillmentType,
            tipCents: cart.tipCents,
            lines: cart.lines,
          },
          customer: {
            name: name.trim(),
            phone: phone.replace(/[^\d+]/g, ''),
            email: email.trim() || null,
          },
          ...(isDelivery
            ? {
                delivery: {
                  addressLine1: delivery.addressLine1.trim(),
                  addressLine2: delivery.addressLine2.trim() || undefined,
                  city: delivery.city.trim(),
                  region: delivery.region.trim() || undefined,
                  postalCode: delivery.postalCode.trim(),
                  country: 'US',
                  instructions: delivery.instructions.trim() || undefined,
                },
              }
            : {}),
        }),
      });
    } catch {
      setSubmitting(false);
      toast.error('Could not reach the restaurant. Check your connection.');
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { url?: string; error?: string }
      | null;

    if (!response.ok || !body?.url) {
      setSubmitting(false);
      toast.error(body?.error ?? 'Checkout could not be started');
      return;
    }

    // Stripe-hosted checkout lives on another origin.
    window.location.assign(body.url);
  }

  const tipOptions = [0, 1000, 1500, 2000, 2500];

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-xl font-semibold">Checkout</h1>

      {!authReady ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          Loading…
        </div>
      ) : !user ? (
        <PhoneVerification
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={() => void supabase.auth.getUser().then(({ data }) => setUser(data.user))}
        />
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">Your details</h2>
          <div className="mt-3 space-y-2">
            <Input
              aria-label="Your name"
              autoComplete="name"
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              aria-label="Email (optional)"
              type="email"
              autoComplete="email"
              placeholder="Email for a receipt (optional)"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </div>
      )}

      {user && isDelivery ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">Delivery address</h2>
          <div className="mt-3 space-y-2">
            <Input
              aria-label="Street address"
              autoComplete="address-line1"
              placeholder="Street address"
              value={delivery.addressLine1}
              onChange={(e) => setDelivery({ ...delivery, addressLine1: e.target.value })}
            />
            <Input
              aria-label="Apartment or suite"
              autoComplete="address-line2"
              placeholder="Apt, suite (optional)"
              value={delivery.addressLine2}
              onChange={(e) => setDelivery({ ...delivery, addressLine2: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                aria-label="City"
                autoComplete="address-level2"
                placeholder="City"
                className="col-span-2"
                value={delivery.city}
                onChange={(e) => setDelivery({ ...delivery, city: e.target.value })}
              />
              <Input
                aria-label="State"
                autoComplete="address-level1"
                placeholder="State"
                value={delivery.region}
                onChange={(e) => setDelivery({ ...delivery, region: e.target.value })}
              />
            </div>
            <Input
              aria-label="ZIP code"
              autoComplete="postal-code"
              placeholder="ZIP"
              value={delivery.postalCode}
              onChange={(e) => setDelivery({ ...delivery, postalCode: e.target.value })}
            />
            <Textarea
              aria-label="Delivery instructions"
              placeholder="Gate code, buzzer, where to leave it…"
              value={delivery.instructions}
              onChange={(e) => setDelivery({ ...delivery, instructions: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      {user ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">Tip</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {tipOptions.map((bps) => {
              const amount = priced
                ? Math.round((priced.subtotalCents * bps) / 10000)
                : 0;
              const active = cart.tipCents === amount;
              return (
                <button
                  key={bps}
                  onClick={() => setTip(amount)}
                  aria-pressed={active}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    active
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                      : 'border-neutral-300 bg-white text-neutral-700'
                  }`}
                >
                  {bps === 0 ? 'No tip' : `${bps / 100}%`}
                  {bps === defaultTipBps ? ' ★' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {pricingError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {pricingError}
        </p>
      ) : null}

      {priced ? (
        <dl className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
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
          {priced.taxCents > 0 ? <Row label="Tax" value={formatCents(priced.taxCents, currency)} /> : null}
          {priced.tipCents > 0 ? <Row label="Tip" value={formatCents(priced.tipCents, currency)} /> : null}
          <Row label="Total" value={formatCents(priced.totalCents, currency)} emphasis />
        </dl>
      ) : null}

      <Button
        className="w-full"
        size="lg"
        disabled={!canSubmit}
        loading={submitting}
        onClick={submit}
      >
        {priced ? `Pay ${formatCents(priced.totalCents, currency)}` : 'Pay'}
      </Button>
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      className={`flex justify-between py-0.5 ${
        emphasis ? 'mt-1.5 border-t border-neutral-200 pt-2 text-base font-semibold' : ''
      }`}
    >
      <dt className={emphasis ? '' : 'text-neutral-600'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
