import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';
import {
  createDeliveryQuote,
  getUberAccessToken,
  redactUberSecrets,
  UberDirectError,
} from '@/lib/uber';
import { uberApiBase, uberAuthUrl, uberEnvironment } from '@/lib/uber-env';

/**
 * Read-only Uber Direct diagnostic.
 *
 * `/api/admin/test-uber` proves OAuth alone, which is the easy half: a
 * token says the PLATFORM credentials work, not that a given restaurant
 * is dispatchable. The parts that actually fail in practice are the
 * per-tenant ones — a missing `uber_customer_id`, a customer id that
 * belongs to the other environment, or a pickup address the courier
 * network will not serve. This walks all of them for one tenant and says
 * which step failed.
 *
 * It requests a QUOTE and never a delivery. A quote is a priced estimate:
 * nothing is dispatched, no courier is assigned, and nothing is billed.
 *
 * Reachable by a super admin from the console, or by a scheduler holding
 * CRON_SECRET — the same two doors as the outbox drain, so it can be run
 * against production without an interactive session.
 *
 * Nothing secret is returned. The client id and secret never appear in
 * the response, and the customer id comes back masked: enough to tell two
 * tenants apart, not enough to reuse.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Step = { step: string; ok: boolean; detail?: string };

const mask = (v: string) => (v.length <= 12 ? '***' : `${v.slice(0, 8)}…${v.slice(-4)}`);

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

  const body = (await request.json().catch(() => ({}))) as {
    tenantSlug?: string;
    dropoffAddress?: string;
    /**
     * Try the quote with a one-off token minted for this OAuth scope
     * instead of the configured one.
     *
     * The configured scope issues a token happily and then 401s on the
     * delivery endpoints, which is indistinguishable from bad credentials
     * unless you can try another scope. This does that in place, without
     * changing production configuration for live traffic.
     */
    probeScope?: string;
  };
  const slug = body.tenantSlug?.trim();
  if (!slug) {
    return NextResponse.json({ error: 'tenantSlug is required' }, { status: 400 });
  }

  const steps: Step[] = [];
  const service = createServiceClient();

  // ---- 1. OAuth --------------------------------------------------------
  try {
    await getUberAccessToken();
    steps.push({ step: 'oauth', ok: true, detail: `environment=${uberEnvironment()}` });
  } catch (error) {
    steps.push({
      step: 'oauth',
      ok: false,
      detail: redactUberSecrets(error instanceof Error ? error.message : 'token request failed'),
    });
    return NextResponse.json({ tenantSlug: slug, environment: uberEnvironment(), steps });
  }

  // ---- 2. Tenant + per-tenant customer id ------------------------------
  const { data: tenant } = await service
    .from('tenants')
    .select('id, name, status')
    .eq('slug', slug)
    .maybeSingle();

  if (!tenant) {
    steps.push({ step: 'tenant', ok: false, detail: 'no tenant with that slug' });
    return NextResponse.json({ tenantSlug: slug, environment: uberEnvironment(), steps });
  }
  steps.push({ step: 'tenant', ok: true, detail: `${tenant.name} (${tenant.status})` });

  const { data: secret } = await service
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', tenant.id)
    .eq('key', 'uber_customer_id')
    .maybeSingle();

  const customerId = secret?.value?.trim();
  if (!customerId) {
    steps.push({
      step: 'customer_id',
      ok: false,
      detail: "no 'uber_customer_id' in tenant_secrets for this tenant",
    });
    return NextResponse.json({ tenantSlug: slug, environment: uberEnvironment(), steps });
  }
  steps.push({ step: 'customer_id', ok: true, detail: mask(customerId) });

  // ---- 3. Pickup address ----------------------------------------------
  const { data: settings } = await service
    .from('tenant_settings')
    .select('address_line1, city, region, postal_code, country, accepts_delivery')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const pickupParts = [
    settings?.address_line1,
    settings?.city,
    settings?.region,
    settings?.postal_code,
  ].filter(Boolean);

  if (!settings?.address_line1 || pickupParts.length < 4) {
    steps.push({
      step: 'pickup_address',
      ok: false,
      detail:
        'tenant_settings has no complete street address, so no quote can be requested for this tenant',
    });
    return NextResponse.json({ tenantSlug: slug, environment: uberEnvironment(), steps });
  }

  const pickup = pickupParts.join(', ');
  steps.push({
    step: 'pickup_address',
    ok: true,
    detail: `${pickup}${settings.accepts_delivery ? '' : ' — NOTE: accepts_delivery is false'}`,
  });

  // ---- 4. Quote (never a delivery) -------------------------------------
  // Dropoff defaults to the pickup's own city so the probe stays inside a
  // region the merchant is actually set up to serve.
  const dropoff =
    body.dropoffAddress?.trim() ||
    `${settings.city}, ${settings.region} ${settings.postal_code}`;

  // ---- 4a. Optional scope probe ---------------------------------------
  if (body.probeScope?.trim()) {
    const scope = body.probeScope.trim();
    const clientId = process.env.UBER_DIRECT_CLIENT_ID?.trim();
    const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      steps.push({ step: 'scope_probe', ok: false, detail: 'client credentials are not configured' });
      return NextResponse.json({ tenantSlug: slug, environment: uberEnvironment(), steps });
    }

    const tokenResponse = await fetch(uberAuthUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenText = await tokenResponse.text();
    if (!tokenResponse.ok) {
      steps.push({
        step: 'scope_probe',
        ok: false,
        detail: redactUberSecrets(`scope=${scope} token HTTP ${tokenResponse.status} ${tokenText.slice(0, 200)}`),
      });
      return NextResponse.json({ tenantSlug: slug, environment: uberEnvironment(), steps });
    }
    const probeToken = (JSON.parse(tokenText) as { access_token?: string }).access_token;
    steps.push({ step: 'scope_probe_token', ok: Boolean(probeToken), detail: `scope=${scope}` });

    const quoteResponse = await fetch(
      `${uberApiBase()}/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${probeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickup_address: pickup,
          dropoff_address:
            body.dropoffAddress?.trim() ||
            `${settings.city}, ${settings.region} ${settings.postal_code}`,
          manifest_total_value: 2000,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const quoteText = await quoteResponse.text();
    steps.push({
      step: 'scope_probe_quote',
      ok: quoteResponse.ok,
      detail: redactUberSecrets(`scope=${scope} HTTP ${quoteResponse.status} ${quoteText.slice(0, 300)}`),
    });
    return NextResponse.json({
      tenantSlug: slug,
      environment: uberEnvironment(),
      apiBase: uberApiBase(),
      dispatchedDelivery: false,
      steps,
    });
  }

  try {
    const quote = await createDeliveryQuote(customerId, {
      pickup_address: pickup,
      dropoff_address: dropoff,
      manifest_total_value: 2000,
    });
    steps.push({
      step: 'quote',
      ok: true,
      detail: `feeCents=${quote.fee} ${quote.currency} eta=${quote.dropoff_eta} durationMins=${quote.duration}`,
    });
    return NextResponse.json({
      tenantSlug: slug,
      environment: uberEnvironment(),
      apiBase: uberApiBase(),
      dispatchedDelivery: false,
      steps,
    });
  } catch (error) {
    // The provider's own code is what distinguishes "this merchant is not
    // provisioned" from "nobody is driving right now"; the generic message
    // alone cannot.
    const code = error instanceof UberDirectError ? error.upstreamCode : null;
    const status = error instanceof UberDirectError ? error.status : null;
    const base = error instanceof Error ? error.message : 'quote request failed';
    steps.push({
      step: 'quote',
      ok: false,
      detail: redactUberSecrets(
        `${base}${status ? ` [HTTP ${status}]` : ''}${code ? ` uberCode=${code}` : ''}`,
      ),
    });
    return NextResponse.json({
      tenantSlug: slug,
      environment: uberEnvironment(),
      apiBase: uberApiBase(),
      dispatchedDelivery: false,
      steps,
    });
  }
}
