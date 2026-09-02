'use client';

import { useState, useTransition } from 'react';
import { Minus, Pause, Play, Plus, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatMinutes } from '@/lib/money';
import type { TenantSettings } from '@/types/database';

/**
 * The pacing bar.
 *
 * Both controls go through RPCs rather than a direct table UPDATE, for two
 * reasons: each writes a semantic `audit_logs.operation` alongside the DML
 * verb, and the prep-time control sends a *delta* so two expediters tapping
 * "+5" at once add ten minutes instead of racing to the same value.
 */
export function KitchenControls({
  tenantId,
  settings,
  onSettingsChange,
  connected,
  soundEnabled,
  onSoundToggle,
}: {
  tenantId: string;
  settings: Pick<
    TenantSettings,
    'is_kitchen_paused' | 'kitchen_paused_reason' | 'estimated_prep_time_mins'
  >;
  onSettingsChange: (settings: TenantSettings) => void;
  connected: boolean;
  soundEnabled: boolean;
  onSoundToggle: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function togglePause() {
    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const next = !settings.is_kitchen_paused;

    const { data, error } = await supabase.rpc('set_kitchen_pause', {
      p_tenant_id: tenantId,
      p_paused: next,
      p_reason: next ? 'Paused from the kitchen display' : undefined,
    });

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    onSettingsChange(data as TenantSettings);
    toast.success(next ? 'New orders paused' : 'Now accepting orders');
  }

  function adjustPrep(delta: number) {
    startTransition(async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('adjust_prep_time', {
        p_tenant_id: tenantId,
        p_delta_mins: delta,
      });

      if (error) {
        toast.error(error.message);
        return;
      }
      onSettingsChange(data as TenantSettings);
    });
  }

  const paused = settings.is_kitchen_paused;

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-700 bg-neutral-900 text-neutral-100">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
            aria-hidden
          />
          <span className="sr-only">
            {connected ? 'Live updates connected' : 'Reconnecting to live updates'}
          </span>
          {connected ? (
            <Wifi className="h-4 w-4 text-neutral-400" aria-hidden />
          ) : (
            <WifiOff className="h-4 w-4 text-amber-400" aria-hidden />
          )}
        </div>

        <h1 className="text-lg font-semibold">Kitchen</h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Prep time */}
          <div className="flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800 p-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-neutral-100 hover:bg-neutral-700"
              aria-label="Decrease prep time by 5 minutes"
              disabled={pending}
              onClick={() => adjustPrep(-5)}
            >
              <Minus className="h-5 w-5" />
            </Button>
            <span
              className="min-w-[5.5rem] text-center text-sm font-semibold tabular-nums"
              aria-live="polite"
            >
              {formatMinutes(settings.estimated_prep_time_mins)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-neutral-100 hover:bg-neutral-700"
              aria-label="Increase prep time by 5 minutes"
              disabled={pending}
              onClick={() => adjustPrep(5)}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="text-neutral-100 hover:bg-neutral-700"
            aria-label={soundEnabled ? 'Mute new order chime' : 'Unmute new order chime'}
            aria-pressed={soundEnabled}
            onClick={onSoundToggle}
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </Button>

          {/* Pause */}
          <Button
            size="lg"
            loading={busy}
            aria-pressed={paused}
            onClick={togglePause}
            className={
              paused
                ? 'bg-amber-500 text-neutral-900 hover:bg-amber-400'
                : 'bg-neutral-100 text-neutral-900 hover:bg-white'
            }
          >
            {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            {paused ? 'Resume orders' : 'Pause orders'}
          </Button>
        </div>
      </div>

      {paused ? (
        <p role="status" className="bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-900">
          New orders are paused. The storefront is showing customers that you are not taking
          orders right now.
        </p>
      ) : null}
    </header>
  );
}
