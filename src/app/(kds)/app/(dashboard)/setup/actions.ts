'use server';

import { revalidatePath } from 'next/cache';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';

export async function approveSetup(): Promise<{ ok: boolean; error?: string }> {
  const staff = await resolveStaffTenantId();
  if (!staff || !staff.canManage) return { ok: false, error: 'Only the restaurant owner can approve setup.' };
  const db = await createClientForRequest();
  const { error } = await (db as any).rpc('approve_tenant_setup', { p_tenant_id: staff.tenantId });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/setup');
  return { ok: true };
}
