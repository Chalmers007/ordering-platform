/**
 * Uber Direct sandbox integration test.
 *
 *   node --env-file=.env.uber.local scripts/test-uber-sandbox.ts
 *
 * Makes REAL calls against Uber's API using the platform's OAuth
 * credentials and the tenant's customer id. It is a script rather than a
 * vitest case on purpose: it costs money and network, and a unit suite
 * that silently depends on a third party stops being a unit suite.
 *
 * Required environment:
 *   UBER_DIRECT_CLIENT_ID, UBER_DIRECT_CLIENT_SECRET
 *   UBER_DIRECT_API_BASE      (https://sandbox-api.uber.com for sandbox)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   UBER_CUSTOMER_ID          (or it is read from tenant_secrets)
 *   TENANT_ID                 (defaults to the demo tenant)
 *
 * Pass --dispatch to actually create a delivery. Without it the script
 * stops after the quote, because a dispatch in a live account books a
 * real courier.
 */

import { createClient } from '@supabase/supabase-js';

const TENANT_ID = process.env.TENANT_ID ?? 'ada81b55-b727-4c2c-a993-efb374dd9eef';
const DISPATCH = process.argv.includes('--dispatch');

const AUTH_URL = 'https://login.uber.com/oauth/v2/token';
const API_BASE = process.env.UBER_DIRECT_API_BASE ?? 'https://api.uber.com';

type Phase = { name: string; ok: boolean; detail: string };
const phases: Phase[] = [];

function record(name: string, ok: boolean, detail: string) {
  phases.push({ name, ok, detail });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}\n        ${detail}`);
}

async function main(): Promise<void> {
  console.log(`\nUber Direct sandbox test against ${API_BASE}\n`);

  // ---- phase 1: configuration ---------------------------------------
  const clientId = process.env.UBER_DIRECT_CLIENT_ID;
  const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    record(
      'Configuration',
      false,
      'UBER_DIRECT_CLIENT_ID / UBER_DIRECT_CLIENT_SECRET are not set. ' +
        'These are issued by Uber for the platform account and cannot be generated locally.',
    );
    summarise();
    process.exit(1);
  }

  let customerId = process.env.UBER_CUSTOMER_ID ?? null;

  if (!customerId) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      record('Configuration', false, 'Set UBER_CUSTOMER_ID, or Supabase credentials to read it.');
      summarise();
      process.exit(1);
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await supabase
      .from('tenant_secrets')
      .select('value')
      .eq('tenant_id', TENANT_ID)
      .eq('key', 'uber_customer_id')
      .maybeSingle();

    customerId = data?.value ?? null;
  }

  if (!customerId) {
    record('Configuration', false, `No uber_customer_id in tenant_secrets for ${TENANT_ID}`);
    summarise();
    process.exit(1);
  }

  record('Configuration', true, `client id present, customer ${customerId}`);

  // ---- phase 2a: OAuth ------------------------------------------------
  let token: string;
  const startedAuth = Date.now();

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'eats.deliveries',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (!response.ok) {
      // Never echo the body: it can contain the client_secret.
      record('OAuth token exchange', false, `HTTP ${response.status} from login.uber.com`);
      summarise();
      process.exit(1);
    }

    const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      record('OAuth token exchange', false, 'Response carried no access_token');
      summarise();
      process.exit(1);
    }

    token = body.access_token;
    record(
      'OAuth token exchange',
      true,
      `token received in ${Date.now() - startedAuth}ms, expires in ${body.expires_in ?? '?'}s`,
    );
  } catch (error) {
    record('OAuth token exchange', false, error instanceof Error ? error.message : 'request failed');
    summarise();
    process.exit(1);
  }

  const call = async <T>(path: string, payload: unknown): Promise<{ ok: boolean; status: number; body: T | string }> => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    try {
      return { ok: response.ok, status: response.status, body: JSON.parse(text) as T };
    } catch {
      return { ok: response.ok, status: response.status, body: text };
    }
  };

  // Uber's documented sandbox addresses.
  const pickup = '425 Market St, San Francisco, CA 94105';
  const dropoff = '1455 Market St, San Francisco, CA 94103';

  // ---- phase 2b: quote -------------------------------------------------
  const quoteResult = await call<{ id?: string; fee?: number; dropoff_eta?: string; currency?: string }>(
    `/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`,
    { pickup_address: pickup, dropoff_address: dropoff, manifest_total_value: 2500 },
  );

  if (!quoteResult.ok || typeof quoteResult.body === 'string' || !quoteResult.body.id) {
    record(
      'Delivery quote',
      false,
      `HTTP ${quoteResult.status}: ${JSON.stringify(quoteResult.body).slice(0, 300)}`,
    );
    summarise();
    process.exit(1);
  }

  const quote = quoteResult.body;
  record(
    'Delivery quote',
    true,
    `quote ${quote.id}, fee ${quote.fee} ${quote.currency ?? ''}, eta ${quote.dropoff_eta ?? 'n/a'}`,
  );

  // ---- phase 2c: dispatch ----------------------------------------------
  if (!DISPATCH) {
    record('Dispatch', true, 'skipped — pass --dispatch to book a real courier');
    summarise();
    return;
  }

  const deliveryResult = await call<{ id?: string; status?: string; tracking_url?: string }>(
    `/v1/customers/${encodeURIComponent(customerId)}/deliveries`,
    {
      quote_id: quote.id,
      pickup_name: 'Sandbox Kitchen',
      pickup_address: pickup,
      pickup_phone_number: '+14155550100',
      dropoff_name: 'Sandbox Customer',
      dropoff_address: dropoff,
      dropoff_phone_number: '+14155550101',
      manifest_items: [{ name: 'Margherita', quantity: 1, size: 'small' }],
      manifest_total_value: 2500,
      external_id: `sandbox-${Date.now()}`,
    },
  );

  if (!deliveryResult.ok || typeof deliveryResult.body === 'string' || !deliveryResult.body.id) {
    record(
      'Dispatch',
      false,
      `HTTP ${deliveryResult.status}: ${JSON.stringify(deliveryResult.body).slice(0, 300)}`,
    );
    summarise();
    process.exit(1);
  }

  const delivery = deliveryResult.body;
  record(
    'Dispatch',
    true,
    `delivery ${delivery.id}, status ${delivery.status}, tracking ${delivery.tracking_url ? 'yes' : 'none'}`,
  );

  console.log(`\nUse this id to exercise the webhook:\n  ${delivery.id}\n`);
}

function summarise(): void {
  const failed = phases.filter((p) => !p.ok).length;
  console.log(`\n${phases.length - failed}/${phases.length} phases passed\n`);
}

main().catch((error: unknown) => {
  console.error(`\nSandbox test could not run: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
