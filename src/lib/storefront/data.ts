import 'server-only';

import { createClientForRequest } from '@/lib/supabase/server';
export { menuImageUrl } from './menu-image';
export { orderingAvailability } from './availability';

import type {
  MenuCategoryWithItems,
  Storefront,
  TenantSettings,
} from '@/types/database';

/**
 * The storefront read path.
 *
 * One round trip, through RLS, as the anonymous visitor. There is no service
 * client here on purpose: if a policy is wrong, the storefront shows less —
 * it never shows another tenant's menu.
 *
 * Unavailable items are fetched deliberately. The storefront renders them as
 * sold out rather than dropping them, so a regular's favourite does not
 * silently vanish from the menu.
 */
export async function loadStorefront(tenantId: string): Promise<Storefront | null> {
  const supabase = await createClientForRequest();

  const [tenantResult, settingsResult, menuResult] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, slug, name, status, timezone, currency')
      .eq('id', tenantId)
      .maybeSingle(),

    supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),

    supabase
      .from('menu_categories')
      .select(
        `*, menu_items (
            *,
            menu_item_modifier_groups (
              *,
              menu_modifier_groups ( *, menu_modifiers ( * ) )
            )
          )`,
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('sort_order', { ascending: true, referencedTable: 'menu_items' }),
  ]);

  if (!tenantResult.data || !settingsResult.data) return null;

  const categories = (menuResult.data ?? []) as unknown as MenuCategoryWithItems[];

  return {
    tenant: tenantResult.data,
    settings: settingsResult.data as TenantSettings,
    // A category with nothing in it is noise on a menu.
    categories: categories.filter((c) => c.menu_items.length > 0),
  };
}
