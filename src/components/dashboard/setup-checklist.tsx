'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { approveSetup } from '@/app/(kds)/app/(dashboard)/setup/actions';

export function SetupChecklist({
  tenantId,
  paymentConfirmed,
  businessDetailsComplete,
  logoPresent,
  bannerPresent,
  menuReady,
  ownerApproved,
  operatorApproved,
  canManage,
}: {
  tenantId: string;
  paymentConfirmed: boolean;
  businessDetailsComplete: boolean;
  logoPresent: boolean;
  bannerPresent: boolean;
  menuReady: boolean;
  ownerApproved: boolean;
  operatorApproved: boolean;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const items = [
    ['Business details', businessDetailsComplete, '/settings'],
    ['Logo', logoPresent, '/settings'],
    ['Banner', bannerPresent, '/settings'],
    ['Menu uploaded and saved', menuReady, '/menu'],
    ['Payment confirmed', paymentConfirmed, null],
    ['Owner approval', ownerApproved, null],
    ['Vardr approval', operatorApproved, null],
  ] as const;
  const readyForOwnerApproval = paymentConfirmed && businessDetailsComplete && logoPresent && bannerPresent && menuReady;

  return (
    <section className="mx-auto w-full max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-neutral-900">
      <h1 className="text-xl font-semibold">Finish setting up your storefront</h1>
      <p className="mt-1 text-sm text-neutral-700">Your account is connected, but the storefront remains preview-only until every requirement is complete.</p>
      <ul className="mt-4 space-y-2">
        {items.map(([label, complete, href]) => (
          <li key={label} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
            <span>{complete ? '✓' : '○'} {label}</span>
            {!complete && href ? <Link className="font-medium text-blue-700 underline" href={href}>Complete</Link> : null}
          </li>
        ))}
      </ul>
      {canManage && !ownerApproved ? (
        <button
          type="button"
          disabled={!readyForOwnerApproval || pending}
          onClick={() => startTransition(async () => {
            const result = await approveSetup();
            if (result.ok) toast.success('Owner approval recorded');
            else toast.error(result.error);
          })}
          className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Approve setup'}
        </button>
      ) : null}
      <p className="mt-3 text-xs text-neutral-600">Tenant: {tenantId}. Ordering stays disabled until Vardr approval activates it.</p>
    </section>
  );
}
