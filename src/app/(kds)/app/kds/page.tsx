import { notFound, redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { createClientForRequest } from '@/lib/supabase/server';
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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.tenant_id || !['tenant_owner', 'tenant_staff'].includes(profile.role)) {
    notFound();
  }

  const [{ data: tenant }, { data: settings }] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, timezone')
      .eq('id', profile.tenant_id)
      .maybeSingle(),
    supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
  ]);

  if (!tenant || !settings) notFound();

  return (
    <>
      <KdsBoard
        tenantId={tenant.id}
        restaurantName={tenant.name}
        timeZone={tenant.timezone}
        initialSettings={settings as TenantSettings}
      />
      <Toaster position="top-right" richColors theme="dark" />
    </>
  );
}
