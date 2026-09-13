'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';

interface Package {
  id: string;
  name: string;
  description: string;
  price_cents: number | null;
  features: string | null;
}

export function PackageSelector({
  tenantId,
}: {
  tenantId: string;
}) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Load packages on mount
  useEffect(() => {
    fetch('/api/packages')
      .then(r => r.json())
      .then(data => {
        setPackages(data.packages || []);
        // Auto-select first package
        if (data.packages?.[0]) {
          setSelectedId(data.packages[0].id);
        }
      })
      .catch(err => {
        console.error('Failed to load packages:', err);
        toast.error('Could not load packages');
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCheckout() {
    if (!selectedId) {
      toast.error('Please select a package');
      return;
    }
    if (!emailValid) {
      toast.error('Enter the email you want your receipt and account sent to');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/package-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          package_id: selectedId,
          customer_email: email.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Checkout failed');
        setBusy(false);
        return;
      }

      // Stripe checkout session, or a GHL payment link - either way, the
      // browser leaves for the payment provider from here.
      const destination = data.checkout_url || data.payment_link_url;
      if (destination) {
        window.location.assign(destination);
      } else {
        toast.error('No checkout URL returned');
        setBusy(false);
      }
    } catch (err) {
      toast.error('Something went wrong');
      console.error(err);
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-lg bg-neutral-700" />
        <div className="h-32 animate-pulse rounded-lg bg-neutral-700" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Package cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            onClick={() => setSelectedId(pkg.id)}
            className={`relative cursor-pointer rounded-lg border-2 p-6 transition-all ${
              selectedId === pkg.id
                ? 'border-yellow-400 bg-yellow-50'
                : 'border-neutral-300 bg-white hover:border-neutral-400'
            }`}
          >
            {/* Selected checkmark */}
            {selectedId === pkg.id && (
              <div className="absolute right-4 top-4 h-6 w-6 rounded-full bg-yellow-400 flex items-center justify-center">
                <span className="text-white font-bold">✓</span>
              </div>
            )}

            {/* Package name */}
            <h3 className="text-lg font-semibold text-neutral-900">{pkg.name}</h3>

            {/* Description */}
            <p className="mt-2 text-sm text-neutral-600">{pkg.description}</p>

            {/* Price */}
            <div className="mt-4">
              {pkg.price_cents === null ? (
                <p className="text-xl font-bold text-neutral-900">Contact us</p>
              ) : pkg.price_cents === 0 ? (
                <p className="text-xl font-bold text-neutral-900">Free</p>
              ) : (
                <p className="text-xl font-bold text-neutral-900">
                  ${(pkg.price_cents / 100).toFixed(2)}
                </p>
              )}
            </div>

            {/* Features */}
            {pkg.features && (
              <ul className="mt-4 space-y-2 text-sm text-neutral-600">
                {pkg.features.split(',').map((feature, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-yellow-600">✓</span>
                    <span>{feature.trim()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Email (required so payment confirmation can be matched back to this restaurant) */}
      <div>
        <label htmlFor="claim-email" className="mb-1 block text-sm font-medium text-white">
          Enter your email address to continue <span className="text-yellow-400">*</span>
        </label>
        <input
          id="claim-email"
          type="email"
          required
          autoComplete="email"
          placeholder="Type your email here, e.g. you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-neutral-900 placeholder:text-neutral-400 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
        />
        <p className="mt-1 text-xs text-neutral-300">
          Use the same email at checkout - it&apos;s how we match your payment back to this storefront.
        </p>
      </div>

      {/* Checkout button */}
      <button
        onClick={handleCheckout}
        disabled={!selectedId || !emailValid || busy}
        className="w-full rounded-lg bg-yellow-400 px-6 py-3 font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? 'Preparing checkout...' : 'Continue to Payment'}
      </button>

      {/* Info */}
      <p className="text-center text-sm text-neutral-600">
        After payment, you&apos;ll complete your account setup and start taking orders.
      </p>
    </div>
  );
}
