'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Staff sign-in for the platform console and the restaurant dashboard.
 *
 * Email and password, not the customers' SMS OTP: staff accounts are created
 * by the platform (or by an owner inviting a colleague), so there is no
 * self-signup path here and none should exist.
 *
 * Authorisation is not decided here. A successful sign-in only proves who
 * you are; whether you may see this surface is settled by `is_super_admin()`
 * / tenant membership in the layout, and by RLS on every query.
 */
export function StaffLogin({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setBusy(false);
    if (error) {
      // Deliberately not "no such user" vs "wrong password": that difference
      // tells an attacker which addresses have accounts.
      toast.error('That email and password do not match.');
      return;
    }

    const next = params.get('next');
    router.replace(next && next.startsWith('/') ? next : '/');
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-6">
      <form
        onSubmit={signIn}
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6"
      >
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>

        <div className="mt-4 space-y-2">
          <Input
            type="email"
            required
            autoComplete="email"
            aria-label="Email"
            placeholder="you@restaurant.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            type="password"
            required
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <Button type="submit" className="mt-4 w-full" size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
