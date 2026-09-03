'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { confirmMenu } from '@/app/(kds)/app/(dashboard)/menu/actions';

/**
 * The owner's confirmation that an imported menu is accurate.
 *
 * Shown only while `menu_verified_at` is null — that is, only for a storefront
 * whose menu was assembled from the business's own website rather than entered
 * by them. Once confirmed it disappears, because there is nothing left to say.
 *
 * The dialog is not ceremony. Confirming releases every scraped item for sale
 * at prices nobody in this business typed, so the count is stated plainly and
 * the action is one deliberate step rather than a stray click.
 */
export function ConfirmMenuCard({ scrapedCount }: { scrapedCount: number }) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const result = await confirmMenu();
      if (!result.ok) {
        // The button stays, so a failure can be retried rather than leaving
        // the owner on a page that looks done and is not.
        toast.error(result.error ?? 'Could not confirm the menu');
        setAsking(false);
        return;
      }
      toast.success('Menu confirmed — items are now available');
      setAsking(false);
    });
  };

  return (
    <section className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <h2 className="text-sm font-semibold text-amber-200">This menu has not been confirmed yet</h2>
      <p className="mt-2 text-sm text-neutral-300">
        {scrapedCount > 0
          ? `${scrapedCount} item${scrapedCount === 1 ? '' : 's'} on this menu ${scrapedCount === 1 ? 'was' : 'were'} imported from your website. `
          : 'This menu was imported rather than entered by you. '}
        Nothing can be ordered until you confirm the prices are right.
      </p>

      {!asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="mt-3 rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-300"
        >
          Confirm this menu is accurate
        </button>
      ) : (
        <div className="mt-3 rounded-md border border-neutral-700 bg-neutral-950 p-3">
          <p className="text-sm text-neutral-200">
            This marks the menu as verified and makes
            {scrapedCount > 0 ? ` all ${scrapedCount} imported items` : ' all imported items'} available to
            order at the prices shown. You can switch any individual item off afterwards.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-60"
            >
              {pending ? 'Confirming…' : 'Yes, this menu is accurate'}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={pending}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
