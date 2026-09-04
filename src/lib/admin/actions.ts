'use server';

import { requireSuperAdmin } from './guard';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Server action to check if a tenant has uber_customer_id configured.
 * Runs on the server with automatic request context (cookies, session).
 * Does not return the value—only existence.
 */
export async function checkTenantUberCustomerId(tenantSlug: string) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return {
      ok: false,
      error: `Not authorized: ${guard.reason}`,
    };
  }

  try {
    const supabase = createServiceClient();

    // Get tenant ID
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .single();

    if (tenantError || !tenant) {
      return { ok: false, error: 'Tenant not found' };
    }

    // Check for uber_customer_id in tenant_secrets
    const { data: secret } = await supabase
      .from('tenant_secrets')
      .select('value')
      .eq('tenant_id', tenant.id)
      .eq('key', 'uber_customer_id')
      .maybeSingle();

    const hasUberId = !!secret?.value;

    return {
      ok: true,
      tenantSlug,
      hasUberCustomerId: hasUberId,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    };
  }
}
