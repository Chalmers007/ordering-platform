'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Owner sign-up for a claimed storefront.
 *
 * The account is created server-side (only the admin API can), then the
 * browser signs itself in. Doing the sign-in on the server would set the
 * session cookie on this storefront host, and the dashboard the owner is
 * being sent to lives on a different origin — they would arrive logged out.
 */
export function ClaimForm({
  token,
  restaurantName,
}: {
  token: string;
  restaurantName: string;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 10;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const response = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email, password, fullName, phone: phone || undefined }),
    });

    const body = (await response.json().catch(() => null)) as
      | { error?: string; redirectTo?: string }
      | null;

    if (!response.ok || !body?.redirectTo) {
      setBusy(false);
      toast.error(body?.error ?? 'Something went wrong. Please try again.');
      return;
    }

    // The account exists now; sign in so the session cookie is set on the
    // root domain and travels to the dashboard.
    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setBusy(false);
      // The claim succeeded even if this did not — say so, rather than
      // implying they need to start over.
      toast.error('Your restaurant is claimed, but sign-in failed. Try logging in.');
      return;
    }

    window.location.assign(body.redirectTo);
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
      >
        <h2 className="font-semibold text-neutral-900">Create your owner account</h2>
        <p className="mt-0.5 text-sm text-neutral-600">
          You will manage {restaurantName} with this login.
        </p>

        <div className="mt-4 space-y-2">
          <Input
            required
            autoComplete="name"
            aria-label="Your name"
            placeholder="Your name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <Input
            required
            type="email"
            autoComplete="email"
            aria-label="Email"
            placeholder="you@restaurant.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            type="tel"
            autoComplete="tel"
            aria-label="Phone (optional)"
            placeholder="Phone (optional)"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Input
            required
            type="password"
            autoComplete="new-password"
            aria-label="Password"
            aria-invalid={tooShort || undefined}
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className={`text-xs ${tooShort ? 'text-red-600' : 'text-neutral-500'}`}>
            At least 10 characters.
          </p>
        </div>

        <Button
          type="submit"
          size="lg"
          className="mt-4 w-full"
          loading={busy}
          disabled={password.length < 10 || !email || !fullName}
        >
          Claim {restaurantName}
        </Button>

        <p className="mt-3 text-xs text-neutral-500">
          Claiming activates your storefront immediately. You can change the menu, hours and
          branding straight afterwards.
        </p>
      </form>
      <Toaster position="top-center" richColors />
    </>
  );
}
