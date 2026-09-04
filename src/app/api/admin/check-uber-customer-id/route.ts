import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check if a tenant has the uber_customer_id configured.
 * Does not return the actual value.
 */
export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 },
    );
  }

  const { tenantSlug } = await request.json();
  if (!tenantSlug) {
    return NextResponse.json({ error: 'Missing tenantSlug' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get tenant ID
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // Check for uber_customer_id in tenant_secrets
  const { data: secret } = await supabase
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', tenant.id)
    .eq('key', 'uber_customer_id')
    .maybeSingle();

  const hasUberId = !!secret?.value;

  return NextResponse.json({
    tenantSlug,
    hasUberCustomerId: hasUberId,
  });
}
