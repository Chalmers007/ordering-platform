import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Toaster } from 'sonner';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { createClientForRequest } from '@/lib/supabase/server';
import { StaffNav } from '@/components/dashboard/staff-nav';

export const dynamic = 'force-dynamic';

/**
 * The restaurant dashboard shell.
 *
 * Guarded here, in a `(dashboard)` route group that adds nothing to the
 * URL, so that /app/login stays OUTSIDE it — a login page inside a layout
 * that rejects unauthenticated visitors renders an empty document and
 * never resolves. Same shape as the admin console.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();

  const supabase = await createClientForRequest();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, slug')
    .eq('id', staff.tenantId)
    .maybeSingle();

  return (
    <div className="min-h-dvh bg-neutral-950">
      <StaffNav
        tenantName={tenant?.name ?? 'Restaurant'}
        storefrontSlug={tenant?.slug ?? null}
        impersonating={staff.impersonating}
      />
      {children}
      <Toaster position="top-right" richColors theme="dark" />
    </div>
  );
}
