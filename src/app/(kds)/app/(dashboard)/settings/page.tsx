import { notFound } from 'next/navigation';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { StoreSettingsForm } from '@/components/dashboard/store-settings-form';
import type { Tenant, TenantSettings } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();

  const supabase = await createClientForRequest();
  const [{ data: tenant }, { data: settings }] = await Promise.all([
    supabase.from('tenants').select('*').eq('id', staff.tenantId).maybeSingle(),
    supabase.from('tenant_settings').select('*').eq('tenant_id', staff.tenantId).maybeSingle(),
  ]);

  if (!tenant || !settings) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold text-neutral-100">Store settings</h1>
      <p className="mt-1 text-sm text-neutral-400">
        {staff.canManage
          ? 'Changes take effect on your storefront immediately.'
          : 'You can change how the kitchen runs. Contact the owner for pricing and contact details.'}
      </p>

      <div className="mt-5">
        <StoreSettingsForm
          tenant={tenant as Tenant}
          settings={settings as TenantSettings}
          canManage={staff.canManage}
        />
      </div>
    </main>
  );
}
