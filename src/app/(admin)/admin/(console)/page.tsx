import { createClientForRequest } from '@/lib/supabase/server';
import { MetricsGrid } from '@/components/admin/metrics-grid';
import { TenantTable, type TenantRow } from '@/components/admin/tenant-table';
import { ErrorFeed } from '@/components/admin/error-feed';
import { CreateTestPreviewButton } from '@/components/admin/create-test-preview-button';
import { TestUberBtn } from '@/components/admin/test-uber-btn';

export const dynamic = 'force-dynamic';

/**
 * Platform overview. Every figure here is aggregated in Postgres by
 * `platform_metrics()`, which re-checks `is_super_admin()` itself — the
 * layout guard decides routing, the database decides access.
 */
export default async function AdminOverviewPage() {
  const supabase = await createClientForRequest();

  const [metricsResult, tenantsResult, errorsResult] = await Promise.all([
    supabase.rpc('platform_metrics'),
    supabase
      .from('tenants')
      .select('*, tenant_settings(tech_fee_enabled, tech_fee_cents, is_kitchen_paused)')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('platform_error_feed', { p_limit: 15 }),
  ]);

  const metrics = metricsResult.data?.[0];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Overview</h1>
        <div className="flex gap-2">
          <TestUberBtn />
          <CreateTestPreviewButton />
        </div>
      </div>

      {metrics ? (
        <div className="mt-4">
          <MetricsGrid metrics={metrics} />
        </div>
      ) : (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {metricsResult.error?.message ?? 'Metrics are unavailable.'}
        </p>
      )}

      <ErrorFeed errors={errorsResult.data ?? []} />

      <TenantTable tenants={(tenantsResult.data ?? []) as unknown as TenantRow[]} />
    </>
  );
}
