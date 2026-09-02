'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatCents } from '@/lib/money';

const DISMISS_KEY = 'op.upsell.dismissed.';

/**
 * Post-checkout account completion.
 *
 * The customer already has an auth user from SMS verification, so "creating an
 * account" is attaching an email and consenting to marketing. Accepting grants
 * a real `customer_rewards` row — the offer is recorded as an entitlement
 * rather than being implied by the copy.
 *
 * Note: nothing redeems these rewards yet. `price_cart()` still returns
 * discountCents = 0 until the promotions slice lands.
 */
export function AccountUpsellModal({
  tenantId,
  orderId,
  rewardCents,
  currency,
}: {
  tenantId: string;
  orderId: string;
  rewardCents: number;
  currency: string;
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY + orderId) !== '1';
    } catch {
      return true;
    }
  });
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY + orderId, '1');
    } catch {
      // Storage unavailable; the modal simply reappears next visit.
    }
    setOpen(false);
  }

  async function save() {
    setBusy(true);
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase.rpc('complete_customer_account', {
      p_tenant_id: tenantId,
      p_email: email.trim() || undefined,
      p_full_name: fullName.trim() || undefined,
      p_marketing_opt_in: true,
      p_order_id: orderId,
    });

    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const result = data as { rewardGranted?: boolean; rewardAmountCents?: number } | null;
    toast.success(
      result?.rewardGranted
        ? `Saved. ${formatCents(result.rewardAmountCents ?? rewardCents, currency)} is on your account.`
        : 'Your details are saved.',
    );
    dismiss();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent className="sm:max-w-md">
        <div className="px-5 pb-5 pt-6">
          <DialogTitle className="pr-8 text-lg font-semibold">
            Save your details and earn {formatCents(rewardCents, currency)} off your next order
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm text-neutral-600">
            Your phone is already verified. Add an email and we will keep your details for next
            time.
          </DialogDescription>

          <div className="mt-4 space-y-2">
            <Input
              aria-label="Your name"
              autoComplete="name"
              placeholder="Name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
            <Input
              aria-label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            Saving opts you in to occasional offers from this restaurant. You can opt out at any
            time.
          </p>

          <div className="mt-5 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={dismiss}>
              No thanks
            </Button>
            <Button className="flex-1" loading={busy} onClick={save} disabled={!email.trim()}>
              Save my details
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
