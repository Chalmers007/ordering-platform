import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import {
  UberDirectError,
  createDeliveryQuote,
  getUberAccessToken,
  probeUberScope,
} from '@/lib/uber';

/**
 * Courier integration health.
 *
 * Answers "can we reach the courier network right now, with these
 * credentials, for this restaurant?" — which is what you want to know
 * before a dinner rush, not during one.
 *
 * It authenticates and requests a QUOTE. Quotes cost nothing and commit to
 * nothing; this endpoint deliberately cannot dispatch, so it is safe to
 * poll and safe to run against a production account.
 *
 * Never returns the token, the client secret, or the customer id.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    Boolean(cronSecret) && request.headers.get('authorization') === `Bearer ${cronSecret}`;

  if (!authorized) {
    const guard = await requireSuperAdmin();
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
        { status: guard.reason === 'unauthenticated' ? 401 : 403 },
      );
    }
  }

  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 422 });
  }

  const apiBase = process.env.UBER_DIRECT_API_BASE ?? 'https://api.uber.com';
  const environment = apiBase.includes('sandbox') ? 'sandbox' : 'production';

  const result: Record<string, unknown> = {
    environment,
    apiBase,
    credentialsPresent: Boolean(
      process.env.UBER_DIRECT_CLIENT_ID && process.env.UBER_DIRECT_CLIENT_SECRET,
    ),
    webhookSecretPresent: Boolean(process.env.UBER_DIRECT_WEBHOOK_SECRET),
  };

  // ---- OAuth ----------------------------------------------------------
  try {
    const token = await getUberAccessToken();
    // Length only. The token itself is never returned.
    result.oauth = { ok: true, tokenLength: token.length };
  } catch (error) {
    // On failure, establish WHICH scope the app is granted rather than
    // leaving someone to guess one deploy at a time.
    const candidates = ['direct.organizations', 'eats.deliveries', ''];
    const probes: Record<string, string> = {};

    for (const scope of candidates) {
      const probe = await probeUberScope(scope);
      probes[scope || '(no scope requested)'] = probe.ok
        ? 'GRANTED'
        : `${probe.status} ${probe.code}`;
    }

    result.oauth = {
      ok: false,
      error: error instanceof UberDirectError ? error.message : 'Authentication failed',
      scopeProbe: probes,
      configuredScope: process.env.UBER_DIRECT_SCOPE ?? 'direct.organizations',
    };
    return NextResponse.json(result, { status: 502 });
  }

  // ---- Quote ----------------------------------------------------------
  const service = createServiceClient();
  const [{ data: secret }, { data: settings }] = await Promise.all([
    service
      .from('tenant_secrets')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', 'uber_customer_id')
      .maybeSingle(),
    service
      .from('tenant_settings')
      .select('address_line1, address_line2, city, region, postal_code, latitude, longitude')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (!secret?.value) {
    result.quote = { ok: false, error: 'This restaurant has no uber_customer_id configured' };
    return NextResponse.json(result, { status: 409 });
  }

  const pickup =
    [settings?.address_line1, settings?.address_line2, settings?.city, settings?.region, settings?.postal_code]
      .filter(Boolean)
      .join(', ') || '425 Market St, San Francisco, CA 94105';

  // A fixed, well-known destination: this is a reachability probe, not a
  // real customer's address.
  const dropoff =
    request.nextUrl.searchParams.get('dropoff') ?? '1455 Market St, San Francisco, CA 94103';

  try {
    const quote = await createDeliveryQuote(secret.value, {
      pickup_address: pickup,
      dropoff_address: dropoff,
      pickup_latitude: settings?.latitude ?? undefined,
      pickup_longitude: settings?.longitude ?? undefined,
      manifest_total_value: 2500,
    });

    result.quote = {
      ok: true,
      quoteId: quote.id,
      feeCents: quote.fee,
      currency: quote.currency,
      dropoffEta: quote.dropoff_eta,
      durationMins: quote.duration,
      pickup,
      dropoff,
    };
    return NextResponse.json(result);
  } catch (error) {
    result.quote = {
      ok: false,
      error: error instanceof UberDirectError ? error.message : 'Quote failed',
      pickup,
      dropoff,
    };
    return NextResponse.json(result, { status: 502 });
  }
}
