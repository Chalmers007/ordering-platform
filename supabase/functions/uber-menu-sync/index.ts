/**
 * uber-menu-sync — marketplace availability into our menu.
 *
 * When a restaurant 86s an item on their Uber Eats tablet, our storefront
 * has to stop selling it. Otherwise a customer pays for food that does not
 * exist, and the first anyone hears of it is the refund.
 *
 * Availability only. Price is deliberately NOT synced: an external system
 * that can rewrite `price_cents` can reprice a whole catalogue with no
 * review step, and checkout re-derives every total from that column.
 *
 * The body is verified before it is parsed. An unverified payload is an
 * anonymous claim about someone else's menu.
 *
 * Deploy:  supabase functions deploy uber-menu-sync
 * Secrets: supabase secrets set UBER_EATS_WEBHOOK_SECRET=...
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('UBER_EATS_WEBHOOK_SECRET') ?? '';

const PROVIDER = 'uber_eats';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * HMAC-SHA256 of the raw body, keyed on the endpoint secret.
 *
 * Mirrors verifyUberSignature() in src/lib/uber-signature.ts, including
 * the length pre-check: timingSafeEqual throws on a length mismatch
 * rather than returning false, which would turn a forged header into a
 * 500 — and a 500 is a retry, so a forged event would be redelivered
 * rather than dropped.
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !WEBHOOK_SECRET) return false;

  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

type MenuEvent = {
  event_id?: string;
  event_type?: string;
  store_id?: string;
  item_id?: string;
  is_available?: boolean;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  // Fail closed. Without a secret every request is unauthenticated, and
  // accepting them would be worse than being unavailable.
  if (!WEBHOOK_SECRET) {
    console.error('[uber-menu-sync] UBER_EATS_WEBHOOK_SECRET is unset; refusing all events');
    return json({ error: 'Webhook not configured' }, 500);
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get('x-uber-signature') ?? req.headers.get('x-envoy-signature');

  if (!verifySignature(rawBody, signature)) {
    // Deliberately terse: a probe learns nothing about why it failed.
    return json({ error: 'Invalid signature' }, 401);
  }

  let payload: MenuEvent;
  try {
    payload = JSON.parse(rawBody) as MenuEvent;
  } catch {
    return json({ error: 'Malformed JSON' }, 400);
  }

  const { event_id, event_type, store_id, item_id, is_available } = payload;

  if (!event_id || !store_id || !item_id || typeof is_available !== 'boolean') {
    return json({ error: 'Missing required fields' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Idempotency, resolution and the write happen together inside the RPC.
  // Splitting them here would let a crash between claiming the event and
  // applying it mark an event processed that never took effect — and the
  // retry would then be discarded as a duplicate.
  const { data, error } = await supabase.rpc('apply_menu_availability_event', {
    p_provider: PROVIDER,
    p_event_id: event_id,
    p_event_type: event_type ?? 'menu.availability',
    p_payload: payload as unknown as Record<string, unknown>,
    p_store_id: store_id,
    p_external_id: item_id,
    p_available: is_available,
  });

  if (error) {
    console.error('[uber-menu-sync] rpc failed', { event_id, code: error.code });
    // 500 so the marketplace retries; the event is left unprocessed.
    return json({ error: 'Internal Server Error' }, 500);
  }

  const status = (data as { status?: string } | null)?.status ?? 'unknown';

  switch (status) {
    case 'applied':
    case 'duplicate':
      // A redelivery is a success. Answering anything else invites an
      // endless retry loop for an event we have already honoured.
      return json({ success: true, status });

    case 'unknown_store':
    case 'unknown_item':
      // 200, not 404: the event was well-formed and authentic, we simply
      // have no mapping for it. A 4xx makes Uber retry an event that will
      // never succeed, and eventually disable the endpoint.
      console.warn('[uber-menu-sync] unmapped', { status, store_id, item_id });
      return json({ success: false, status });

    default:
      console.error('[uber-menu-sync] unexpected status', { status, event_id });
      return json({ error: 'Internal Server Error' }, 500);
  }
});
