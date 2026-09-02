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
