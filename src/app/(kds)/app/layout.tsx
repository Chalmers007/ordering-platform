import type { ReactNode } from 'react';
import { createClientForRequest } from '@/lib/supabase/server';
import { ImpersonationBanner } from '@/components/admin/impersonation-banner';

export const dynamic = 'force-dynamic';

/**
 * Staff surface shell.
 *
 * Its only job is the impersonation banner. An administrator who lands here
 * from the console is operating inside someone else's restaurant, and
 * without this there is nothing telling them so and no way back — the
 * banner lives on the admin layout, which they have just left.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const supabase = await createClientForRequest();
  const { data } = await supabase.rpc('active_impersonation');
  const active = data?.[0] ?? null;

  return (
    <>
      {active ? (
        <ImpersonationBanner tenantName={active.tenant_name} startedAt={active.started_at} />
      ) : null}
      {children}
    </>
  );
}
