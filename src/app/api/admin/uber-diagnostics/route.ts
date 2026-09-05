import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';
import { createDeliveryQuote, getUberAccessToken, redactUberSecrets } from '@/lib/uber';
import { uberApiBase, uberEnvironment } from '@/lib/uber-env';

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
    steps.push({
      step: 'quote',
      ok: false,
      detail: redactUberSecrets(error instanceof Error ? error.message : 'quote request failed'),
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
