'use client';

import { useEffect, useState } from 'react';
import { Clock, PauseCircle } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatMinutes } from '@/lib/money';

/**
 * Kitchen pacing, live.
 *
 * Staff pause the kitchen from the KDS and the storefront must reflect it
 * immediately — not on the customer's next page load, by which time they may
 * already be at checkout. `tenant_settings` carries REPLICA IDENTITY FULL so
 * this filtered subscription actually receives UPDATEs.
 */
export function KitchenStatusBanner({
  tenantId,
  initialPaused,
  initialReason,
  initialPrepMins,
}: {
  tenantId: string;
  initialPaused: boolean;
  initialReason: string | null;
  initialPrepMins: number;
}) {
  const [paused, setPaused] = useState(initialPaused);
  const [reason, setReason] = useState(initialReason);
  const [prepMins, setPrepMins] = useState(initialPrepMins);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`storefront:settings:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenant_settings',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const next = payload.new as {
            is_kitchen_paused: boolean;
            kitchen_paused_reason: string | null;
            estimated_prep_time_mins: number;
          };
          setPaused(next.is_kitchen_paused);
          setReason(next.kitchen_paused_reason);
          setPrepMins(next.estimated_prep_time_mins);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  if (paused) {
    return (
      <div role="status" className="border-b border-amber-300 bg-amber-50">
        <div className="mx-auto flex w-full max-w-5xl items-start gap-2 px-4 py-3 text-sm text-amber-900">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">Not accepting orders right now.</strong>{' '}
            {reason?.trim() || 'The kitchen has paused new orders. Please check back shortly.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2 text-sm text-neutral-600">
        <Clock className="h-4 w-4 shrink-0" aria-hidden />
        <p>
          Currently about <strong className="font-semibold text-neutral-900">{formatMinutes(prepMins)}</strong> to prepare
        </p>
      </div>
    </div>
  );
}
