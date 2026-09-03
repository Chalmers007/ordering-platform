import 'server-only';

import { headers } from 'next/headers';
import { createClientForRequest } from '@/lib/supabase/server';
import {
  IMPERSONATION_HEADER,
  IMPERSONATION_SESSION_HEADER,
} from './impersonation';

/**
 * Super-admin gate.
 *
 * `is_super_admin()` is asked of the database, not inferred from a claim in
 * the session or a role cached in the app. RLS is the real boundary — every
 * admin query still runs under it — and this exists so an unauthorised
 * visitor gets a clean 403 instead of an empty dashboard.
 */

export type AdminContext = {
  userId: string;
  /** The tenant being viewed through impersonation, if any. */
  impersonatedTenantId: string | null;
  impersonationSessionId: string | null;
};

export type AdminGuardResult =
  | { ok: true; context: AdminContext }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' };

export async function requireSuperAdmin(): Promise<AdminGuardResult> {
  const supabase = await createClientForRequest();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };

  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin');
  if (error || !isSuperAdmin) return { ok: false, reason: 'forbidden' };

  const h = await headers();
  return {
    ok: true,
    context: {
      userId: user.id,
      // Set by middleware only after verifying the signed cookie against
      // this same user, so it is safe to read here.
      impersonatedTenantId: h.get(IMPERSONATION_HEADER),
      impersonationSessionId: h.get(IMPERSONATION_SESSION_HEADER),
    },
  };
}

/**
 * Which tenant a staff-surface page should render.
 *
 * Normally the signed-in member's own tenant. But a super admin has no
 * tenant_id at all — the user_profiles constraint forbids it — so without
 * this an impersonating administrator lands on notFound() and the whole
 * "Log in as" flow leads nowhere.
 *
 * The impersonated tenant is only honoured for an actual super admin, and
 * the header it comes from is set by the proxy only after verifying the
 * signed cookie against that same user. RLS still governs every read.
 */
export async function resolveStaffTenantId(): Promise<
  { tenantId: string; impersonating: boolean } | null
> {
  const supabase = await createClientForRequest();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;

  if (profile.role === 'super_admin') {
    const impersonated = (await headers()).get(IMPERSONATION_HEADER);
    return impersonated ? { tenantId: impersonated, impersonating: true } : null;
  }

  if (!profile.tenant_id || !['tenant_owner', 'tenant_staff'].includes(profile.role)) {
    return null;
  }

  return { tenantId: profile.tenant_id, impersonating: false };
}
