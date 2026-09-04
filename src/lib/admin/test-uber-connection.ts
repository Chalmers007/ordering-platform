import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from './guard';
import {
  UberDirectError,
  createDeliveryQuote,
  getUberAccessToken,
  probeUberScope,
  uberEnvironment,
} from '@/lib/uber';

/**
 * Super Admin only: Test Uber Direct sandbox connectivity and scope eligibility.
 * Safe result object—no credentials, tokens, or secrets exposed.
 */
export async function testUberConnection(): Promise<{
  ok: boolean;
  environment: 'sandbox' | 'production';
  oauth?: { ok: boolean; error?: string; grantedScope?: string };
  quote?: { ok: boolean; error?: string; quoteId?: string; feeCents?: number };
  error?: string;
}> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return { ok: false, environment: uberEnvironment(), error: 'Super Admin required' };
  }

  const environment = uberEnvironment();
  const result: {
    ok: boolean;
    environment: 'sandbox' | 'production';
    oauth?: { ok: boolean; error?: string; grantedScope?: string };
    quote?: { ok: boolean; error?: string; quoteId?: string; feeCents?: number };
    error?: string;
  } = {
    ok: false,
    environment,
  };

  // Test OAuth
  try {
    await getUberAccessToken();
    result.oauth = { ok: true };
  } catch (error) {
    // Identify which scope is granted
    const candidates = [
      'eats.deliveries',
      'direct.organizations',
      'direct.deliveries',
      'delivery',
      'deliveries',
      'eats.store',
      'eats.order',
      'direct',
    ];

    let grantedScope: string | undefined;
    for (const scope of candidates) {
      const probe = await probeUberScope(scope, 'body');
      if (probe.ok) {
        grantedScope = scope;
        break;
      }
    }

    result.oauth = {
      ok: false,
      error: error instanceof UberDirectError ? error.message : 'Authentication failed',
      grantedScope,
    };
    return result;
  }

  // Test Quote (sandbox only, no dispatch)
  try {
    const service = createServiceClient();
    const { data: secret } = await service
      .from('tenant_secrets')
      .select('value')
      .eq('key', 'uber_customer_id')
      .limit(1)
      .maybeSingle();

    if (!secret?.value) {
      result.quote = { ok: false, error: 'No test tenant with uber_customer_id found' };
      return result;
    }

    const quote = await createDeliveryQuote(secret.value, {
      pickup_address: '425 Market St, San Francisco, CA 94105',
      dropoff_address: '1455 Market St, San Francisco, CA 94103',
      manifest_total_value: 2500,
    });

    result.ok = true;
    result.quote = {
      ok: true,
      quoteId: quote.id,
      feeCents: quote.fee,
    };
  } catch (error) {
    result.quote = {
      ok: false,
      error: error instanceof UberDirectError ? error.message : 'Quote test failed',
    };
  }

  return result;
}
