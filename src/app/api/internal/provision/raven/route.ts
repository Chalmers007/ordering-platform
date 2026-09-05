import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseAndStage, StagingError } from '@/lib/scraper/parse-and-stage';
import { ravenProvisionSchema, parseKeyRing, signaturesEqual, REPLAY_WINDOW_SECONDS, type RavenProvisionResponse } from '@/lib/integrations/raven-provision';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
function fail(code: string, message: string, retryable = false, status = 400) { return json({ error_code: code, error_message: message, retryable }, status); }

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') || request.headers.get('referer') || request.headers.get('cookie')) return fail('browser_forbidden', 'server-to-server requests only', false, 403);
  const source = request.headers.get('x-vardr-source'); const timestamp = request.headers.get('x-vardr-timestamp'); const nonce = request.headers.get('x-vardr-nonce'); const keyId = request.headers.get('x-vardr-key-id'); const signature = request.headers.get('x-vardr-signature');
  if (!source || !timestamp || !nonce || !keyId || !signature) return fail('missing_auth', 'signed headers are required', false, 401);
  if (source !== 'raven') return fail('wrong_source', 'invalid source identity', false, 403);
  const seconds = Number(timestamp); if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > REPLAY_WINDOW_SECONDS) return fail('stale_timestamp', 'request timestamp is outside the replay window', false, 401);
  const raw = await request.text(); const secret = parseKeyRing().get(keyId); if (!secret) return fail('unknown_key', 'unknown signing key', false, 401);
  const expected = (await import('@/lib/integrations/raven-provision')).signRequest({ source, timestamp, nonce, keyId, method: 'POST', path: new URL(request.url).pathname, body: raw }, secret);
  if (!signaturesEqual(signature, expected)) return fail('invalid_signature', 'signature verification failed', false, 401);
  let body: unknown; try { body = JSON.parse(raw); } catch { return fail('malformed_request', 'request body must be JSON'); }
  const parsed = ravenProvisionSchema.safeParse(body); if (!parsed.success) return fail('invalid_request', 'request failed validation');
  // The provisioning tables are added by the migration and regenerated types
  // may lag in a deployed checkout; keep the boundary server-only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const now = new Date();
  const { error: nonceError } = await db.from('raven_provision_nonces').insert({ nonce, source_system: 'raven', key_id: keyId, expires_at: new Date(now.getTime() + REPLAY_WINDOW_SECONDS * 1000).toISOString() } as never);
  if (nonceError) return fail('replayed_nonce', 'nonce has already been used', false, 409);
  const p = parsed.data;
  if (!p.menu_content) return fail('menu_required', 'menu_content is required for first provisioning', false, 422);
  const byIdempotency = await db.from('raven_provisioning_requests').select('*').eq('source_system', 'raven').eq('idempotency_key', p.idempotency_key).maybeSingle();
  const byProspect = byIdempotency.data ? byIdempotency : await db.from('raven_provisioning_requests').select('*').eq('source_system', 'raven').eq('raven_prospect_id', p.raven_prospect_id).maybeSingle();
  const byPlace = byProspect.data || !p.google_place_id ? byProspect : await db.from('raven_provisioning_requests').select('*').eq('source_system', 'raven').eq('google_place_id', p.google_place_id).maybeSingle();
  const existing = byPlace.data || (await db.from('raven_provisioning_requests').select('*').eq('source_system', 'raven').eq('normalized_business_name', p.normalized_business_name).eq('normalized_address', p.normalized_address).maybeSingle()).data;
  if (existing) return json(toResponse(existing));
  const { data: row, error } = await db.from('raven_provisioning_requests').insert({ ...p, source_system: 'raven', provisioning_status: 'processing', attempt_count: 1 } as never).select('*').single();
  if (error || !row) {
    // A concurrent winner may have committed between the read and insert.
    const winner = (await db.from('raven_provisioning_requests').select('*').eq('source_system', 'raven').eq('idempotency_key', p.idempotency_key).maybeSingle()).data;
    if (winner) return json(toResponse(winner));
    return fail('duplicate_identity', 'a provisioning request already exists for this restaurant', false, 409);
  }
  try {
    const staged = await parseAndStage({ content: p.menu_content, sourceUrl: p.normalized_website ?? 'https://menu.invalid', nameHint: p.normalized_business_name });
    const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    const claimUrl = root ? `https://admin.${root}/claim?token=${staged.claimToken}` : null;
    const { data: updated } = await db.from('raven_provisioning_requests').update({ provisioning_status: 'succeeded', tenant_id: staged.tenantId, claim_url: claimUrl, retryable: false, updated_at: now.toISOString() } as never).eq('id', row.id).select('*').single();
    return json(toResponse(updated ?? { ...row, provisioning_status: 'succeeded', tenant_id: staged.tenantId, claim_url: claimUrl }));
  } catch (e) {
    const retryable = !(e instanceof StagingError && ['no_menu', 'unparseable', 'invalid', 'conflict'].includes(e.reason));
    const { data: updated } = await db.from('raven_provisioning_requests').update({ provisioning_status: retryable ? 'failed' : 'exhausted', retryable, last_error: e instanceof Error ? e.message : 'provisioning failed', error_code: e instanceof StagingError ? e.reason : 'provisioning_error', next_retry_at: retryable ? new Date(now.getTime() + 60_000).toISOString() : null } as never).eq('id', row.id).select('*').single();
    return json(toResponse(updated ?? row), retryable ? 503 : 422);
  }
}
function toResponse(row: Record<string, unknown>): RavenProvisionResponse { return { request_id: String(row.id), source_system: 'raven', raven_prospect_id: String(row.raven_prospect_id), idempotency_key: String(row.idempotency_key), ordering_tenant_id: row.tenant_id ? String(row.tenant_id) : null, preview_id: row.preview_id ? String(row.preview_id) : null, claim_url: row.claim_url ? String(row.claim_url) : null, preview_url: row.preview_url ? String(row.preview_url) : null, provisioning_status: row.provisioning_status as RavenProvisionResponse['provisioning_status'], expires_at: row.expires_at ? String(row.expires_at) : null, retryable: Boolean(row.retryable), error_code: row.error_code ? String(row.error_code) : null, error_message: row.last_error ? String(row.last_error) : null }; }
