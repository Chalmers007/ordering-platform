import { describe, expect, it } from 'vitest';
import {
  BOARD_STATUSES,
  belongsToTenant,
  columnForStatus,
  groupIntoBoard,
  isOnBoard,
  primaryActionFor,
  urgencyFor,
  waitingMinutes,
} from './board';
import type { OrderWithDetails } from '@/types/database';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function order(patch: Partial<OrderWithDetails>): OrderWithDetails {
  return {
    id: crypto.randomUUID(),
    tenant_id: TENANT,
    status: 'paid',
    fulfillment_type: 'delivery',
    placed_at: '2026-09-02T17:00:00.000Z',
    created_at: '2026-09-02T17:00:00.000Z',
    promised_at: null,
    order_items: [],
    ...patch,
  } as unknown as OrderWithDetails;
}

describe('column mapping', () => {
  it('puts newly paid and kitchen-confirmed orders together as new work', () => {
    expect(columnForStatus('paid')).toBe('received');
    expect(columnForStatus('confirmed')).toBe('received');
  });

  it('maps the working statuses to their own columns', () => {
    expect(columnForStatus('preparing')).toBe('preparing');
    expect(columnForStatus('ready')).toBe('ready');
  });

  it('keeps orders the kitchen no longer owns off the board', () => {
    for (const status of ['draft', 'pending_payment', 'out_for_delivery', 'completed', 'cancelled', 'refunded'] as const) {
      expect(isOnBoard(status), `${status} should not be on the board`).toBe(false);
    }
    expect(BOARD_STATUSES).toEqual(['paid', 'confirmed', 'preparing', 'ready']);
  });
});

describe('tenant scoping', () => {
  it('accepts a row from the active tenant', () => {
    expect(belongsToTenant({ tenant_id: TENANT }, TENANT)).toBe(true);
  });

  it('rejects a row from another tenant', () => {
    // The single worst failure this product can have is one kitchen seeing
    // another's tickets.
    expect(belongsToTenant({ tenant_id: OTHER }, TENANT)).toBe(false);
  });

  it('rejects a row with no tenant at all', () => {
    expect(belongsToTenant({ tenant_id: null }, TENANT)).toBe(false);
    expect(belongsToTenant({}, TENANT)).toBe(false);
    expect(belongsToTenant(null, TENANT)).toBe(false);
    expect(belongsToTenant(undefined, TENANT)).toBe(false);
  });

  it('filters foreign orders out of the board even if they reach the client', () => {
    const board = groupIntoBoard(
      [
        order({ status: 'paid' }),
        order({ status: 'preparing', tenant_id: OTHER }),
        order({ status: 'ready', tenant_id: OTHER }),
      ],
      TENANT,
    );

    expect(board.received).toHaveLength(1);
    expect(board.preparing).toHaveLength(0);
    expect(board.ready).toHaveLength(0);
  });
});

describe('board grouping', () => {
  it('orders each column oldest first', () => {
    const board = groupIntoBoard(
      [
        order({ status: 'paid', placed_at: '2026-09-02T17:20:00.000Z' }),
        order({ status: 'paid', placed_at: '2026-09-02T17:05:00.000Z' }),
        order({ status: 'paid', placed_at: '2026-09-02T17:12:00.000Z' }),
      ],
      TENANT,
    );

    expect(board.received.map((o) => o.placed_at)).toEqual([
      '2026-09-02T17:05:00.000Z',
      '2026-09-02T17:12:00.000Z',
      '2026-09-02T17:20:00.000Z',
    ]);
  });

  it('drops statuses that are not kitchen work', () => {
    const board = groupIntoBoard(
      [order({ status: 'completed' }), order({ status: 'out_for_delivery' })],
      TENANT,
    );
    expect(board.received.concat(board.preparing, board.ready)).toHaveLength(0);
  });
});

describe('advance actions', () => {
  it('offers the next step for each kitchen status', () => {
    expect(primaryActionFor({ status: 'paid', fulfillment_type: 'delivery' })?.to).toBe('preparing');
    expect(primaryActionFor({ status: 'confirmed', fulfillment_type: 'pickup' })?.to).toBe('preparing');
    expect(primaryActionFor({ status: 'preparing', fulfillment_type: 'pickup' })?.to).toBe('ready');
  });

  it('branches on fulfilment once the food is ready', () => {
    // A pickup order has no driver to hand to.
    expect(primaryActionFor({ status: 'ready', fulfillment_type: 'delivery' })?.to).toBe('out_for_delivery');
    expect(primaryActionFor({ status: 'ready', fulfillment_type: 'pickup' })?.to).toBe('completed');
  });

  it('offers nothing for a finished or cancelled order', () => {
    expect(primaryActionFor({ status: 'completed', fulfillment_type: 'pickup' })).toBeNull();
    expect(primaryActionFor({ status: 'cancelled', fulfillment_type: 'pickup' })).toBeNull();
  });
});

describe('urgency', () => {
  const placed = '2026-09-02T17:00:00.000Z';
  const at = (iso: string) => new Date(iso).getTime();

  it('counts minutes since the order was placed', () => {
    expect(waitingMinutes({ placed_at: placed, created_at: placed }, at('2026-09-02T17:18:00.000Z'))).toBe(18);
  });

  it('is late once the promise time has passed', () => {
    const o = { placed_at: placed, created_at: placed, promised_at: '2026-09-02T17:30:00.000Z' };
    expect(urgencyFor(o, at('2026-09-02T17:10:00.000Z'))).toBe('normal');
    expect(urgencyFor(o, at('2026-09-02T17:27:00.000Z'))).toBe('due');
    expect(urgencyFor(o, at('2026-09-02T17:31:00.000Z'))).toBe('late');
  });

  it('falls back to elapsed time when nothing was promised', () => {
    const o = { placed_at: placed, created_at: placed, promised_at: null };
    expect(urgencyFor(o, at('2026-09-02T17:10:00.000Z'))).toBe('normal');
    expect(urgencyFor(o, at('2026-09-02T17:16:00.000Z'))).toBe('due');
    expect(urgencyFor(o, at('2026-09-02T17:26:00.000Z'))).toBe('late');
  });
});
