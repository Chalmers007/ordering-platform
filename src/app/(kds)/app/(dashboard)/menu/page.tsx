import { notFound } from 'next/navigation';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { MenuManager } from '@/components/dashboard/menu-manager';
import type { MenuCategory, MenuItem, MenuModifierGroup } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();

  const supabase = await createClientForRequest();

  const [{ data: categories }, { data: items }, { data: groups }, { data: links }] =
    await Promise.all([
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
