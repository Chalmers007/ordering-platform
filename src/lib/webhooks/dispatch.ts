import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import type { WebhookEvent } from '@/types/database';
// Exponential, capped. A dead endpoint should back off, not hammer.
import { backoffSeconds } from './backoff';

/**
 * Outbound webhook drain (GoHighLevel).
 *
 * `webhook_events` is a durable outbox: rows are enqueued inside the same
 * transaction that writes the thing they describe, so nothing is lost when
 * an HTTP call fails. But an outbox nobody drains is worse than no outbox --
 * it looks like delivery and is silence. So this runs immediately after an
 * enqueue AND is exposed for a scheduler to call.
 *
 * The destination URL lives in `tenant_secrets`, readable only by the
 * service role.
 */

const MAX_BATCH = 25;
const SECRET_KEY = 'ghl_webhook_url';

export type DrainResult = { delivered: number; failed: number; skipped: number };

export async function drainWebhookEvents(tenantId?: string): Promise<DrainResult> {
  const service = createServiceClient();
  const result: DrainResult = { delivered: 0, failed: 0, skipped: 0 };

  let query = service
    .from('webhook_events')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(MAX_BATCH);

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data: events, error } = await query;
  if (error || !events?.length) return result;

  // One secret lookup per tenant, not per event.
  const urls = new Map<string, string | null>();

  for (const event of events as WebhookEvent[]) {
    if (!urls.has(event.tenant_id)) {
      const { data: secret } = await service
        .from('tenant_secrets')
        .select('value')
        .eq('tenant_id', event.tenant_id)
        .eq('key', SECRET_KEY)
        .maybeSingle();
      urls.set(event.tenant_id, secret?.value ?? null);
    }

    const url = urls.get(event.tenant_id);
    if (!url) {
      // "Not configured" is not a failure to retry forever: the row waits
      // so it delivers once the tenant connects their CRM.
      result.skipped += 1;
      continue;
    }

    // The database stores facts, not URLs — it has no idea what domain this
    // deployment answers on. The tracking link is assembled here, where the
    // root domain is known, so a notification can carry a link the customer
    // can actually open.
    let payload = event.payload as Record<string, unknown>;
    if (event.order_id) {
      const { data: order } = await service
        .from('orders')
        .select('tracking_token, tenants(slug)')
        .eq('id', event.order_id)
        .maybeSingle();

      const slug = (order?.tenants as { slug?: string } | null)?.slug;
      const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

      if (order?.tracking_token && slug && root) {
        const protocol = root.startsWith('localhost') ? 'http' : 'https';
        payload = {
          ...payload,
          // The opaque token, not the order id: this link is opened from a
          // text message, by someone who may not be signed in.
          trackingUrl: `${protocol}://${slug}.${root}/orders/${order.tracking_token}`,
        };
      }
    }

    const attempts = event.attempts + 1;
    let ok = false;
    let status: number | null = null;
    let lastError: string | null = null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: event.event_type, ...payload }),
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      ok = response.ok;
      if (!ok) lastError = `Endpoint returned ${response.status}`;
    } catch (fetchError) {
      lastError = fetchError instanceof Error ? fetchError.message : 'Delivery failed';
    }

    if (ok) {
      await service
        .from('webhook_events')
        .update({
          status: 'delivered',
          attempts,
          response_status: status,
          delivered_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', event.id);
      result.delivered += 1;
      continue;
    }

    const exhausted = attempts >= event.max_attempts;
    await service
      .from('webhook_events')
      .update({
        status: exhausted ? 'abandoned' : 'pending',
        attempts,
        response_status: status,
        last_error: lastError,
        next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString(),
      })
      .eq('id', event.id);
    result.failed += 1;
  }

  return result;
}
