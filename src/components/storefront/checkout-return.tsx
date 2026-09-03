'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useCart } from '@/lib/cart/cart-context';
import { Button } from '@/components/ui/button';

/**
 * Waits for the Stripe webhook to create the order, then hands the customer
 * to live tracking.
 *
 * Payment has already succeeded by the time this renders — so a slow webhook
 * is a wait, never a failure. After roughly a minute we stop spinning and say
 * so honestly instead of looping forever.
 */
const POLL_MS = 2_000;
const MAX_ATTEMPTS = 30;

export function CheckoutReturn({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { clear } = useCart();
  const [attempts, setAttempts] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    async function poll() {
      const { data } = await supabase.rpc('resolve_checkout_order', {
        p_session_id: sessionId,
      });

      const row = data?.[0];
      if (cancelled) return;

      if (row?.order_id) {
        // The cart is only cleared once the order provably exists.
        clear();
        router.replace(`/orders/${row.order_id}?status=success`);
        return;
      }

      setAttempts((n) => {
        if (n + 1 >= MAX_ATTEMPTS) setGaveUp(true);
        return n + 1;
      });
    }

    if (gaveUp) return;
    const id = window.setTimeout(() => void poll(), attempts === 0 ? 0 : POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [attempts, gaveUp, sessionId, router, clear]);

  if (gaveUp) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-lg font-semibold">Your payment went through</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-600">
          We are still confirming the order with the restaurant. You will get a text as soon as
          it is in the kitchen — there is no need to pay again.
        </p>
        <Button className="mt-5" variant="outline" onClick={() => setGaveUp(false)}>
          Check again
        </Button>
      </div>
    );
  }

  return (
    <div className="py-20 text-center" role="status" aria-live="polite">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-neutral-400" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">Confirming your order</h1>
      <p className="mt-1 text-sm text-neutral-600">This takes a moment.</p>
    </div>
  );
}
