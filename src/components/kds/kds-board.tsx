'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KDS_COLUMNS, groupIntoBoard } from '@/lib/kds/board';
import { useKdsOrders } from '@/lib/kds/use-kds-orders';
import { useChime } from '@/lib/kds/use-chime';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { loadPrinterConfig, printJob, savePrinterConfig } from '@/lib/hardware/printer';
import { renderTicket } from '@/lib/hardware/ticket';
import { KitchenControls } from './kitchen-controls';
import { OrderTicket } from './order-ticket';
import { PrinterSettings } from './printer-settings';
import type {
  OrderStatus,
  OrderWithDetails,
  PrinterConfig,
  TenantSettings,
} from '@/types/database';

export function KdsBoard({
  tenantId,
  restaurantName,
  timeZone,
  initialSettings,
}: {
  tenantId: string;
  restaurantName: string;
  timeZone: string;
  initialSettings: TenantSettings;
}) {
  const { orders, loading, error, connected, onArrival } = useKdsOrders(tenantId);
  const [settings, setSettings] = useState<TenantSettings>(initialSettings);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [printerConfig, setPrinterConfig] = useState<PrinterConfig>(() =>
    loadPrinterConfig(tenantId),
  );
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  // Re-read from localStorage after mount: the server render has no access
  // to it and would otherwise mismatch on hydration.
  useEffect(() => {
    setPrinterConfig(loadPrinterConfig(tenantId));
  }, [tenantId]);

  const { play, unlock } = useChime(soundEnabled);

  // A ticking clock, so wait times and the late/due colours advance without
  // needing a database event.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const printTicket = useCallback(
    async (order: OrderWithDetails, silent = false) => {
      const job = renderTicket(order, {
        restaurantName,
        columns: printerConfig.columns,
        variant: 'kitchen',
        timeZone,
      });
      const result = await printJob(job, printerConfig);
      if (!result.ok && !silent) toast.error(result.error);
      if (!result.ok && silent) {
        // Auto-print failing silently would mean tickets quietly stop
        // reaching the pass. Say so, once, without blocking the board.
        toast.error(`Auto-print failed: ${result.error}`);
      }
      return result;
    },
    [printerConfig, restaurantName, timeZone],
  );

  // New order: chime, and print if this station is set to.
  useEffect(
    () =>
      onArrival((order) => {
        play();
        if (printerConfig.autoPrintOnCreate) void printTicket(order, true);
      }),
    [onArrival, play, printerConfig.autoPrintOnCreate, printTicket],
  );

  // Kitchen pacing can also be changed from the dashboard or another
  // station, so this board follows tenant_settings rather than owning it.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`kds:settings:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenant_settings',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => setSettings(payload.new as TenantSettings),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  const board = useMemo(() => groupIntoBoard(orders, tenantId), [orders, tenantId]);

  async function advance(order: OrderWithDetails, to: string) {
    setBusyOrderId(order.id);
    const supabase = getSupabaseBrowserClient();

    const { error: rpcError } = await supabase.rpc('advance_order_status', {
      p_order_id: order.id,
      p_to_status: to as OrderStatus,
    });

    if (rpcError) {
      setBusyOrderId(null);
      toast.error(rpcError.message);
      return;
    }

    // Book the courier as the food starts, not when it is finished, so a
    // driver is on the way while it cooks. Deliberately not fatal: the
    // order has moved regardless, and a dispatch failure is recorded
    // against the delivery row for staff to retry.
    if (to === 'preparing' && order.fulfillment_type === 'delivery') {
      try {
        const response = await fetch(`/api/orders/${order.id}/dispatch`, { method: 'POST' });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          // A restaurant with no courier account is a normal state, not an
          // error worth shouting about on every ticket.
          if (response.status !== 409) toast.error(body?.error ?? 'Could not book a courier');
        }
      } catch {
        toast.error('Could not reach the courier service');
      }
    }

    setBusyOrderId(null);
    // The board redraws from the Realtime UPDATE, not from this response —
    // so every station sees the same move at the same time.
  }

  async function cancel(order: OrderWithDetails) {
    const reason = window.prompt(`Cancel order ${order.order_number}? Reason:`);
    if (reason === null) return;

    setBusyOrderId(order.id);
    const supabase = getSupabaseBrowserClient();
    const { error: rpcError } = await supabase.rpc('advance_order_status', {
      p_order_id: order.id,
      p_to_status: 'cancelled',
      p_note: reason || 'Cancelled from the kitchen display',
    });

    setBusyOrderId(null);
    if (rpcError) toast.error(rpcError.message);
  }

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100" onPointerDown={unlock}>
      <KitchenControls
        tenantId={tenantId}
        settings={settings}
        onSettingsChange={setSettings}
        connected={connected}
        soundEnabled={soundEnabled}
        onSoundToggle={() => setSoundEnabled((value) => !value)}
      />

      <div className="flex items-center justify-end gap-2 px-4 pt-2">
        <PrinterSettings
          tenantId={tenantId}
          config={printerConfig}
          onConfigChange={(next) => {
            setPrinterConfig(next);
            savePrinterConfig(tenantId, next);
          }}
          sampleOrder={orders[0] ?? null}
          restaurantName={restaurantName}
        />
      </div>

      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {KDS_COLUMNS.map((column) => {
          const tickets = board[column.id];
          return (
            <section key={column.id} aria-labelledby={`col-${column.id}`} className="min-w-0">
              <h2
                id={`col-${column.id}`}
                className="mb-2 flex items-baseline justify-between border-b border-neutral-700 pb-2 text-sm font-semibold uppercase tracking-wide text-neutral-300"
              >
                {column.title}
                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs tabular-nums text-neutral-200">
                  {tickets.length}
                </span>
              </h2>

              <div className="space-y-3">
                {loading ? (
                  <p className="py-8 text-center text-sm text-neutral-500">Loading…</p>
                ) : tickets.length === 0 ? (
                  <p className="py-8 text-center text-sm text-neutral-600">Nothing here</p>
                ) : (
                  tickets.map((order) => (
                    <OrderTicket
                      key={order.id}
                      order={order}
                      now={now}
                      busy={busyOrderId === order.id}
                      onAdvance={advance}
                      onCancel={cancel}
                      onPrint={(target) => void printTicket(target)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
