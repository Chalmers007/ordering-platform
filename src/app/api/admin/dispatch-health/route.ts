import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { getDispatchMetrics } from '@/lib/dispatch/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin API: Dispatch health metrics.
 *
 * Returns success rate, status breakdown, and retry queue status for a tenant.
 * Super Admin only.
 */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  try {
    const metrics = await getDispatchMetrics(tenantId);
    return NextResponse.json(metrics);
  } catch (error) {
    console.error('[dispatch-health] Error', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 },
    );
  }
}
