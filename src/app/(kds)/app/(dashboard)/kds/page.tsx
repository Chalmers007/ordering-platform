import { notFound, redirect } from 'next/navigation';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { KdsBoard } from '@/components/kds/kds-board';
import type { TenantSettings } from '@/types/database';

export const dynamic = 'force-dynamic';

/**
 * The Kitchen Display System.
 *
 * Reached at app.<root>/kds, which middleware rewrites to /app/kds — hence
 * the `app` segment inside the `(kds)` group.
 *
 * The tenant comes from the signed-in staff member's profile, not from a
 * host header: a staff member belongs to exactly one restaurant, and the KDS
 * must show theirs and only theirs.
 */
export default async function KdsPage() {
  const supabase = await createClientForRequest();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/kds');

  // Staff see their own restaurant; a super admin sees the one they are
  // impersonating. A super admin has no tenant of their own, so without
  // this the "Log in as" flow would land here on a 404.
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();

  const [{ data: tenant }, { data: settings }] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, timezone')
      .eq('id', staff.tenantId)
      .maybeSingle(),
    supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', staff.tenantId)
      .maybeSingle(),
  ]);

  if (!tenant || !settings) notFound();

  return (
    <KdsBoard
        tenantId={tenant.id}
        restaurantName={tenant.name}
        timeZone={tenant.timezone}
      initialSettings={settings as TenantSettings}
    />
  );
}
