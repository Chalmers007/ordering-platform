import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-time setup: Store demo Uber sandbox Customer ID for vardr-upload-test.
 * Super Admin access required. This endpoint stores only the demo/sandbox ID.
 * Not for production use.
 */
export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { customerId } = (await request.json().catch(() => ({}))) as {
    customerId?: string;
  };

  if (!customerId) {
    return NextResponse.json({ error: 'customerId required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get tenant ID
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', 'vardr-upload-test')
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // Insert/upsert the secret
  const { error: upsertError } = await supabase
    .from('tenant_secrets')
    .upsert(
      {
        tenant_id: tenant.id,
        key: 'uber_customer_id',
        value: customerId,
      },
      { onConflict: 'tenant_id,key' },
    );

  if (upsertError) {
    return NextResponse.json(
      { error: `Failed to store: ${upsertError.message}` },
      { status: 500 },
    );
  }

  // Verify it was stored
  const { data: verify, error: verifyError } = await supabase
    .from('tenant_secrets')
    .select('key, updated_at')
    .eq('tenant_id', tenant.id)
    .eq('key', 'uber_customer_id')
    .single();

  if (verifyError || !verify) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    tenant: 'vardr-upload-test',
    key: 'uber_customer_id',
    stored: true,
    timestamp: verify.updated_at,
  });
}
