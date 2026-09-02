import type { TenantSettings } from '@/types/database';

/**
 * Whether the storefront may take an order right now.
 *
 * Deliberately not in `data.ts`: that module is `server-only`, and both the
 * banner and the cart's disabled state need this. One function means the two
 * can never disagree about whether ordering is open.
 */
export function orderingAvailability(settings: TenantSettings): {
  canOrder: boolean;
  reason: string | null;
} {
  if (settings.is_kitchen_paused) {
    return {
      canOrder: false,
      reason:
        settings.kitchen_paused_reason?.trim() ||
        'The kitchen has paused new orders. Please check back shortly.',
    };
  }
  if (!settings.accepts_delivery && !settings.accepts_pickup) {
    return { canOrder: false, reason: 'This restaurant is not accepting orders right now.' };
  }
  return { canOrder: true, reason: null };
}
