'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrderWithDetails } from '@/types/database';
import { BOARD_STATUSES, belongsToTenant, isOnBoard } from './board';

const ORDER_SELECT = `
  *,
  order_items ( *, order_item_modifiers ( * ) ),
  deliveries ( * ),
  order_status_events ( * )
`;

/**
 * The live board.
 *
 * Realtime carries the *fact* that something changed; the row it delivers is
 * flat, with no line items. So an event triggers a scoped re-read of that one
 * order rather than being trusted as the new state — which also means the
 * re-read passes back through RLS, and a payload for another tenant can never
 * become a ticket.
 */
export function useKdsOrders(tenantId: string) {
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Callers register interest in new arrivals (chime, auto-print) without
  // this hook knowing anything about audio or printers.
  const arrivalHandlers = useRef<Set<(order: OrderWithDetails) => void>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());

  const onArrival = useCallback((handler: (order: OrderWithDetails) => void) => {
    arrivalHandlers.current.add(handler);
    return () => {
      arrivalHandlers.current.delete(handler);
    };
  }, []);

  const upsert = useCallback(
    (order: OrderWithDetails, announce: boolean) => {
      if (!belongsToTenant(order, tenantId)) return;

      setOrders((current) => {
        const without = current.filter((o) => o.id !== order.id);
        // An order that has left the kitchen's statuses leaves the board.
        return isOnBoard(order.status) ? [...without, order] : without;
      });

      if (announce && !knownIds.current.has(order.id) && isOnBoard(order.status)) {
        knownIds.current.add(order.id);
        for (const handler of arrivalHandlers.current) handler(order);
      }
      knownIds.current.add(order.id);
    },
    [tenantId],
  );

  const fetchOne = useCallback(
    async (orderId: string, announce: boolean) => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('id', orderId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (data) upsert(data as unknown as OrderWithDetails, announce);
    },
    [tenantId, upsert],
  );

  const refetchAll = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data, error: queryError } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('tenant_id', tenantId)
      .in('status', [...BOARD_STATUSES])
      .order('placed_at', { ascending: true });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as OrderWithDetails[];
    // Seed the known set on first load so a page refresh does not chime for
    // every ticket already on the pass.
    for (const row of rows) knownIds.current.add(row.id);
    setOrders(rows.filter((row) => belongsToTenant(row, tenantId)));
    setError(null);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetchAll();
  }, [refetchAll]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // Realtime evaluates RLS with whatever token the SOCKET carries, not the
    // one the REST client uses. Subscribing before the session reaches the
    // socket means it authenticates as `anon`, RLS on `orders` denies, and
    // every event is dropped -- the board reports "connected" and then never
    // updates, which is the worst possible failure for a kitchen. So hand it
    // the access token first, explicitly.
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`kds:${tenantId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
          (payload) => {
            const row = payload.new as { id?: string; tenant_id?: string };
            if (!row.id || !belongsToTenant(row, tenantId)) return;
            void fetchOne(row.id, true);
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
          (payload) => {
            const row = payload.new as { id?: string; tenant_id?: string };
            if (!row.id || !belongsToTenant(row, tenantId)) return;
            void fetchOne(row.id, false);
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'order_items', filter: `tenant_id=eq.${tenantId}` },
          (payload) => {
            const row = (payload.new ?? payload.old) as { order_id?: string; tenant_id?: string };
            if (!row?.order_id || !belongsToTenant(row, tenantId)) return;
            void fetchOne(row.order_id, false);
          },
        )
        .subscribe((status) => {
          setConnected(status === 'SUBSCRIBED');
          // A dropped socket means the board silently stops updating. Re-read
          // the whole board on every (re)connect rather than trusting that no
          // events were missed while it was down.
          if (status === 'SUBSCRIBED') void refetchAll();
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tenantId, fetchOne, refetchAll]);

  return { orders, loading, error, connected, onArrival, refetchAll };
}
