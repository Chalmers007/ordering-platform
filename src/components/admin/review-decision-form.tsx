'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { reviewTenantSetup } from '@/app/(admin)/admin/(console)/reviews/actions';

export function ReviewDecisionForm({ tenantId, decision }: { tenantId: string; decision: 'approved' | 'rejected' }) {
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const reject = decision === 'rejected';
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => {
        const result = await reviewTenantSetup({ tenantId, decision, reason });
        if (!result.ok) { toast.error(result.error); return; }
        toast.success(reject ? 'Setup returned for changes.' : 'Setup approved for activation review.');
        router.refresh();
      });
    }} className="space-y-2">
      {reject ? <textarea aria-label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell the owner what needs to change" className="min-h-20 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" /> : null}
      <button type="submit" disabled={pending} className={`w-full rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${reject ? 'bg-red-700' : 'bg-emerald-700'}`}>
        {pending ? 'Saving…' : reject ? 'Request changes' : 'Approve setup'}
      </button>
    </form>
  );
}
