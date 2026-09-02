'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Guest verification by SMS OTP.
 *
 * A "guest" still ends up with a real auth user — that is what lets RLS scope
 * their order to them, and what makes the post-checkout upsell a matter of
 * adding an email rather than creating an account from scratch.
 */
export function PhoneVerification({
  phone,
  onPhoneChange,
  onVerified,
}: {
  phone: string;
  onPhoneChange: (phone: string) => void;
  onVerified: () => void;
}) {
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const supabase = getSupabaseBrowserClient();
  const normalized = phone.replace(/[^\d+]/g, '');

  async function sendCode() {
    if (normalized.replace(/\D/g, '').length < 7) {
      toast.error('Enter a valid mobile number');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setStage('code');
    toast.success('We texted you a code');
  }

  async function verify() {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: normalized,
      token: code.trim(),
      type: 'sms',
    });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Phone verified');
    onVerified();
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="font-semibold">Verify your phone</h2>
      <p className="mt-1 text-sm text-neutral-600">
        We text order updates here — no account needed.
      </p>

      {stage === 'phone' ? (
        <div className="mt-3 flex gap-2">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-label="Mobile number"
            placeholder="555 123 4567"
            value={phone}
            onChange={(event) => onPhoneChange(event.target.value)}
          />
          <Button onClick={sendCode} loading={busy}>
            Send code
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              aria-label="Verification code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button onClick={verify} loading={busy} disabled={code.trim().length < 4}>
              Verify
            </Button>
          </div>
          <button
            onClick={() => setStage('phone')}
            className="text-sm text-neutral-600 underline underline-offset-2"
          >
            Use a different number
          </button>
        </div>
      )}
    </div>
  );
}
