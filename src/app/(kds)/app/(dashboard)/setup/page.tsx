import { notFound } from 'next/navigation';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { PackageSelector } from '@/components/claim/package-selector';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();
  const db = await createClientForRequest();
  const service = createServiceClient();
  const [{ data: tenant }, { data: settings }, { count: ownerItems }, { data: purchase }, { data: requirements }] = await Promise.all([
    db.from('tenants').select('id, name, support_email, support_phone').eq('id', staff.tenantId).maybeSingle(),
    db.from('tenant_settings').select('logo_url, cover_image_url').eq('tenant_id', staff.tenantId).maybeSingle(),
    db.from('menu_items').select('id', { count: 'exact', head: true }).eq('tenant_id', staff.tenantId).eq('source', 'owner'),
    (service as any).from('package_purchases').select('status').eq('tenant_id', staff.tenantId).maybeSingle(),
    (db as any).from('tenant_activation_requirements').select('owner_approved_at, operator_approved_at').eq('tenant_id', staff.tenantId).maybeSingle(),
  ]);
  if (!tenant || !settings) notFound();
  const details = Boolean(tenant.support_email && tenant.support_phone);
  const payment = purchase?.status === 'confirmed';
  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
      <SetupChecklist tenantId={staff.tenantId} paymentConfirmed={payment} businessDetailsComplete={details} logoPresent={Boolean(settings.logo_url)} bannerPresent={Boolean(settings.cover_image_url)} menuReady={(ownerItems ?? 0) > 0} ownerApproved={Boolean(requirements?.owner_approved_at)} operatorApproved={Boolean(requirements?.operator_approved_at)} canManage={staff.canManage} />
      {!payment ? <PackageSelector tenantId={staff.tenantId} /> : null}
    </main>
  );
}
