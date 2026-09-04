'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { activateStorefront } from '@/app/(kds)/app/(dashboard)/settings/actions';

export function StorefrontActivationCard({
  status,
  menuConfirmed,
  hasLogo,
  hasBanner,
  canManage,
}: {
  status: string;
  menuConfirmed: boolean;
  hasLogo: boolean;
  hasBanner: boolean;
  canManage: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  if (status === 'active') {
    return (
      <section className="mb-5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
        <h2 className="font-semibold text-emerald-200">Storefront active</h2>
        <p className="mt-1 text-sm text-neutral-300">Customers can reach the published storefront.</p>
      </section>
    );
  }

  if (status !== 'pending' || !canManage) return null;

  const ready = menuConfirmed && hasLogo && hasBanner;
  const run = () => {
    startTransition(async () => {
      const result = await activateStorefront();
      if (!result.ok) {
        toast.error(result.error);
        setAsking(false);
        return;
      }
      toast.success('Storefront activated');
      setAsking(false);
    });
  };

  return (
    <section className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <h2 className="font-semibold text-amber-200">Publish your storefront</h2>
      <p className="mt-1 text-sm text-neutral-300">
        Your storefront remains offline until every required review is complete.
      </p>
      <ul className="mt-3 space-y-1 text-sm text-neutral-300">
        <li>{menuConfirmed ? '✓' : '○'} Menu confirmed</li>
        <li>{hasLogo ? '✓' : '○'} Logo uploaded</li>
        <li>{hasBanner ? '✓' : '○'} Banner uploaded</li>
      </ul>
      {!ready ? (
        <p className="mt-3 text-sm text-neutral-400">Complete the items above to enable activation.</p>
      ) : !asking ? (
        <button type="button" onClick={() => setAsking(true)} className="mt-3 rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-300">
          Activate storefront
        </button>
      ) : (
        <div className="mt-3 rounded-md border border-neutral-700 bg-neutral-950 p-3">
          <p className="text-sm text-neutral-200">Publish this storefront and allow customers to order?</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={run} disabled={pending} className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-60">
              {pending ? 'Activating…' : 'Yes, activate storefront'}
            </button>
            <button type="button" onClick={() => setAsking(false)} disabled={pending} className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 disabled:opacity-60">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
