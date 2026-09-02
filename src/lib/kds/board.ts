import type { OrderStatus, OrderWithDetails } from '@/types/database';

/**
 * Board layout and state machine.
 *
 * Pure and separate from the components so the rules a kitchen depends on —
 * which orders appear, which button each one gets, what a tap does — can be
 * tested without rendering anything or opening a socket.
 */

export type KdsColumnId = 'received' | 'preparing' | 'ready';

export type KdsColumnDef = {
  id: KdsColumnId;
  title: string;
  statuses: readonly OrderStatus[];
};

export const KDS_COLUMNS: readonly KdsColumnDef[] = [
  // 'paid' is money taken but the kitchen has not accepted yet; 'confirmed'
  // is accepted but not started. Both are "new work" to an expediter, so
  // they share a column rather than splitting attention.
  { id: 'received', title: 'Received', statuses: ['paid', 'confirmed'] },
  { id: 'preparing', title: 'Preparing', statuses: ['preparing'] },
  { id: 'ready', title: 'Ready', statuses: ['ready'] },
] as const;

/** Statuses that belong on the board at all. An order that is out for
 *  delivery, completed, cancelled or refunded is no longer the kitchen's. */
export const BOARD_STATUSES: readonly OrderStatus[] = KDS_COLUMNS.flatMap((c) => c.statuses);

export function columnForStatus(status: OrderStatus): KdsColumnId | null {
  return KDS_COLUMNS.find((column) => column.statuses.includes(status))?.id ?? null;
}

export function isOnBoard(status: OrderStatus): boolean {
  return columnForStatus(status) !== null;
}

/**
 * Tenant scoping for Realtime payloads.
 *
 * Postgres RLS already prevents another tenant's row from reaching this
 * client, and the subscription carries a server-side filter. This is the
 * third check, in the client, because a board that ever renders another
 * restaurant's order is the single worst failure this product can have —
 * and defence in depth costs one comparison.
 */
export function belongsToTenant(
  row: { tenant_id?: string | null } | null | undefined,
  tenantId: string,
): boolean {
  return Boolean(row?.tenant_id) && row!.tenant_id === tenantId;
}

export type BoardAction = {
  to: OrderStatus;
  label: string;
  tone: 'primary' | 'accent' | 'neutral';
};

/**
 * The button a ticket gets. Mirrors `advance_order_status()`'s transition
 * table — the database is the enforcement, this decides what to offer.
 */
export function primaryActionFor(order: {
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
}): BoardAction | null {
  switch (order.status) {
    case 'paid':
    case 'confirmed':
      return { to: 'preparing', label: 'Start preparing', tone: 'primary' };
    case 'preparing':
      return { to: 'ready', label: 'Mark ready', tone: 'accent' };
    case 'ready':
      return order.fulfillment_type === 'delivery'
        ? { to: 'out_for_delivery', label: 'Hand to driver', tone: 'primary' }
        : { to: 'completed', label: 'Picked up', tone: 'primary' };
    default:
      return null;
  }
}

export function canCancel(status: OrderStatus): boolean {
  return isOnBoard(status);
}

export type KdsBoardState = Record<KdsColumnId, OrderWithDetails[]>;

export function emptyBoard(): KdsBoardState {
  return { received: [], preparing: [], ready: [] };
}

/**
 * Group orders into columns, oldest first — the ticket that has been waiting
 * longest is the one that needs attention, so it goes at the top.
 */
export function groupIntoBoard(orders: OrderWithDetails[], tenantId: string): KdsBoardState {
  const board = emptyBoard();

  for (const order of orders) {
    if (!belongsToTenant(order, tenantId)) continue;
    const column = columnForStatus(order.status);
    if (!column) continue;
    board[column].push(order);
  }

  for (const column of Object.values(board)) {
    column.sort((a, b) => {
      const left = new Date(a.placed_at ?? a.created_at).getTime();
      const right = new Date(b.placed_at ?? b.created_at).getTime();
      return left - right;
    });
  }

  return board;
}

/** Minutes a ticket has been waiting; drives the ageing colour. */
export function waitingMinutes(order: { placed_at: string | null; created_at: string }, now = Date.now()): number {
  const placed = new Date(order.placed_at ?? order.created_at).getTime();
  return Math.max(0, Math.floor((now - placed) / 60_000));
}

/** Late is relative to what the customer was promised, not a fixed number. */
export function urgencyFor(
  order: { placed_at: string | null; created_at: string; promised_at: string | null },
  now = Date.now(),
): 'normal' | 'due' | 'late' {
  if (order.promised_at) {
    const promised = new Date(order.promised_at).getTime();
    if (now > promised) return 'late';
    if (promised - now <= 5 * 60_000) return 'due';
    return 'normal';
  }

  const waited = waitingMinutes(order, now);
  if (waited >= 25) return 'late';
  if (waited >= 15) return 'due';
  return 'normal';
}
