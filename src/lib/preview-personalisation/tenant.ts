import 'server-only';
import { getTenantContext } from '@/lib/tenancy/context';
import { createServiceClient } from '@/lib/supabase/server';
import { currentPreviewSession } from './session';

/** Path previews lack host routing headers. Verify their ID before using storage. */
export async function resolvePreviewTenant(requestedId?: string) {
  const context = await getTenantContext();
  if (context) return { tenantId: context.tenantId, persisted: true };
  if (!requestedId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId)) return null;
  const db = createServiceClient();
  const { data: tenant } = await db.from('tenants').select('id').eq('id', requestedId).maybeSingle();
  if (tenant) return { tenantId: tenant.id, persisted: true };
  const session = await currentPreviewSession(requestedId);
  if (session) return { tenantId: requestedId, persisted: false, session };
  // This table is not yet included in the generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fallback } = await (db as any).from('demo_fallback_state').select('tenant_id').eq('tenant_id', requestedId).maybeSingle();
  return fallback ? { tenantId: requestedId, persisted: false } : null;
}
