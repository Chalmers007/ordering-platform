import type { ReactNode } from 'react';
import Link from 'next/link';
import { forbidden, redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createClientForRequest } from '@/lib/supabase/server';
import { ImpersonationBanner } from '@/components/admin/impersonation-banner';

export const dynamic = 'force-dynamic';

/**
 * The platform console.
 *
 * Guarded here so every page beneath inherits the check — and guarded again
 * by RLS on every query, because a layout check alone is a routing decision,
 * not a security boundary.
 *
 * It lives in a `(console)` route group, which adds nothing to the URL, so
 * that /admin/login sits OUTSIDE it. A login page inside a layout that
 * redirects unauthenticated visitors to that same login page renders an
 * empty document and never resolves.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const guard = await requireSuperAdmin();

  if (!guard.ok) {
    if (guard.reason === 'unauthenticated') redirect('/login?next=/');
    // 403, not a 404: the person is signed in, they simply are not staff.
    forbidden();
  }

  const supabase = await createClientForRequest();
  const { data: impersonation } = await supabase.rpc('active_impersonation');
  const active = impersonation?.[0] ?? null;

  return (
    <div className="min-h-dvh bg-neutral-100 text-neutral-900">
      {active ? (
        <ImpersonationBanner tenantName={active.tenant_name} startedAt={active.started_at} />
      ) : null}

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-3">
          <span className="text-sm font-semibold">Platform</span>
          <nav className="flex gap-4 text-sm">
            <Link className="text-neutral-600 hover:text-neutral-900" href="/">
              Overview
            </Link>
            <Link className="text-neutral-600 hover:text-neutral-900" href="/audit">
              Audit log
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 py-6">{children}</main>
      <Toaster position="top-center" richColors />
    </div>
  );
}
