'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Shown when this page is reached with no usable claim-session cookie -
 * the normal case for a GHL buyer, since the payment link's redirect
 * always lands on the same fixed URL rather than the tenant's own
 * subdomain (see /api/claim/recover for the full reasoning).
 */
export function RecoverForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/claim/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Something went wrong. Please try again.');
      setBusy(false);
      return;
    }

    // The cookie is set now; reload so the server component picks it up.
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-2 text-left">
      <Input
        required
        type="email"
        autoComplete="email"
        aria-label="Email you paid with"
        placeholder="you@restaurant.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email}>
        Continue
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
