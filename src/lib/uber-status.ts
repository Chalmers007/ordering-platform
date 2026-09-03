/**
 * Courier status vocabulary and money conversion.
 *
 * Deliberately not in `uber.ts`: that module is `server-only`, and these
 * are the parts worth testing on their own. (Same split as
 * `webhooks/backoff.ts` and `storefront/availability.ts` — pure logic
 * lives outside the server-only boundary so it stays reachable from
 * vitest.)
 */

export type DeliveryStatusValue =
  | 'unassigned'
  | 'assigned'
  | 'picked_up'
  | 'en_route'
  | 'delivered'
  | 'failed'
  | 'cancelled';

/**
 * Returns null for anything unrecognised rather than guessing: silently
 * mapping an unknown status onto 'delivered' would close an order that is
 * still out.
 */
export function mapUberStatus(raw: string | null | undefined): DeliveryStatusValue | null {
  switch ((raw ?? '').toLowerCase()) {
    case 'pending':
    case 'scheduled':
    case 'pickup':
    case 'en_route_to_pickup':
      return 'assigned';
    case 'pickup_complete':
      return 'picked_up';
    case 'dropoff':
    case 'en_route_to_dropoff':
      return 'en_route';
    case 'delivered':
    case 'dropoff_complete':
      return 'delivered';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'returned':
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/** Uber quotes fees in cents, which is what the rest of the platform uses
 *  — converted explicitly, because a unit mismatch here becomes a
 *  hundredfold error in a delivery fee. */
export function quoteFeeCents(quote: { fee: number }): number {
  return Math.round(quote.fee);
}
