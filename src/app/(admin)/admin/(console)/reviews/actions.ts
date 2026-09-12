'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createClientForRequest } from '@/lib/supabase/server';

export async function reviewTenantSetup(input: {
  tenantId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return { ok: false, error: 'Only authorized Vardr operators can review setup.' };
  if (!/^[0-9a-f-]{36}$/i.test(input.tenantId)) return { ok: false, error: 'Invalid tenant.' };
  if (input.decision === 'rejected' && !input.reason?.trim()) return { ok: false, error: 'A reason is required when rejecting setup.' };

  // Keep the operator's JWT on the RPC call. A service-role client has no
  // auth.uid(), so the database-side is_super_admin() check would correctly
  // reject it even after the page guard passed.
  const db = await createClientForRequest();
  const { error } = await (db as any).rpc('review_tenant_setup', {
    p_tenant_id: input.tenantId,
    p_decision: input.decision,
    p_reason: input.reason?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/reviews');
  revalidatePath(`/admin/reviews/${input.tenantId}`);
  return { ok: true };
}
