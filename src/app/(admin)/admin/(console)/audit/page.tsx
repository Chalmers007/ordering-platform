import { createClientForRequest } from '@/lib/supabase/server';
import { AuditLogViewer } from '@/components/admin/audit-log-viewer';
import type { AuditLog } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const supabase = await createClientForRequest();

  const [{ data: tenants }, { data: logs }] = await Promise.all([
    supabase.from('tenants').select('id, name').order('name'),
    supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <>
      <h1 className="text-xl font-semibold">Audit log</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Every write to menus, orders, settings, gateways, and profiles across the platform.
        Entries are append-only.
      </p>

      <div className="mt-4">
        <AuditLogViewer tenants={tenants ?? []} initialLogs={(logs ?? []) as AuditLog[]} />
      </div>
    </>
  );
}
