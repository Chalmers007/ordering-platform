import { notFound } from 'next/navigation';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { MenuManager } from '@/components/dashboard/menu-manager';
import { ConfirmMenuCard } from '@/components/dashboard/confirm-menu-card';
import type { MenuCategory, MenuItem, MenuModifierGroup } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();

  const supabase = await createClientForRequest();

  const [{ data: tenant }, { data: categories }, { data: items }, { data: groups }, { data: links }] =
    await Promise.all([
      supabase.from('tenants').select('menu_verified_at').eq('id', staff.tenantId).maybeSingle(),
      supabase
        .from('menu_categories')
        .select('*')
        .eq('tenant_id', staff.tenantId)
        .order('sort_order'),
      supabase
        .from('menu_items')
        .select('*')
        .eq('tenant_id', staff.tenantId)
        .order('sort_order'),
      supabase
        .from('menu_modifier_groups')
        .select('*')
        .eq('tenant_id', staff.tenantId)
        .order('sort_order'),
      supabase
        .from('menu_item_modifier_groups')
        .select('item_id, group_id')
        .eq('tenant_id', staff.tenantId),
    ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-xl font-semibold text-neutral-100">Menu manager</h1>
      {/* Only while unconfirmed. After confirm_menu() sets the timestamp this
          disappears, and a repeat click is impossible because the control is
          gone — not merely disabled. */}
      {tenant && !tenant.menu_verified_at && (
        <ConfirmMenuCard scrapedCount={(items ?? []).filter((i) => i.source === 'scraped').length} />
      )}
      <p className="mt-1 text-sm text-neutral-400">
        Changes appear on your storefront straight away.
      </p>

      <div className="mt-5">
        <MenuManager
          categories={(categories ?? []) as MenuCategory[]}
          items={(items ?? []) as MenuItem[]}
          groups={(groups ?? []) as MenuModifierGroup[]}
          links={links ?? []}
        />
      </div>
    </main>
  );
}
