import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseAndStage, StagingError } from '@/lib/scraper/parse-and-stage';
import { ravenProvisionSchema, parseKeyRing, signaturesEqual, REPLAY_WINDOW_SECONDS, validateMenu, buildClaimUrl, type RavenProvisionRequest, type RavenProvisionResponse } from '@/lib/integrations/raven-provision';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
function fail(code: string, message: string, retryable = false, status = 400) { return json({ error_code: code, error_message: message, retryable }, status); }

function buildPreviewUrl(tenantId: string): string | null {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim();
  if (!root) return null;
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${root}/preview/${tenantId}`;
}

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
  // The identity lookup runs BEFORE any menu requirement. The contract says a
  // retry "returns the stored result without resending the menu", and this
  // used to reject a menu-less body first, so a correctly-formed retry got
  // 422 instead of the response it had already earned. validateMenu() below
  // still answers 'menu_required' for a genuine first request.
  const found = await findExisting(db, p);

  // If we found an existing request, return it UNLESS it failed without creating
  // a tenant. Failed requests with tenant_id=null are retryable: they may have
  // failed due to a schema constraint that was later fixed (e.g., sample menu support).
  // A request that already succeeded (or is processing/exhausted) is immutable.
  if (found && found.row.provisioning_status !== 'failed') {
    return settleIdentity(found, p);
  }
  if (found && found.row.provisioning_status === 'failed' && found.row.tenant_id) {
    // Failed but created a tenant: immutable, don't retry
    return settleIdentity(found, p);
  }
  // If we get here: found.row.provisioning_status === 'failed' && !found.row.tenant_id
  // This request failed without creating a tenant. Allow re-processing with the
  // same idempotency_key: schema fixes (like sample menu support) may now allow success.
  const menuError = validateMenu(p); if (menuError) return fail(menuError, menuError === 'menu_hash_mismatch' ? 'menu content hash does not match' : menuError === 'stale_menu' ? 'menu content is stale' : 'menu fields are required for first provisioning', false, 422);
  // Written as an explicit column list rather than a spread of the request.
  // The spread carried `version` — protocol metadata with no column — so
  // every first provisioning failed on "column version does not exist", and
  // it would silently break again the next time the contract gained a field.
  // `menu_content` is never persisted; only its provenance is.
  const record = {
    source_system: 'raven',
    raven_prospect_id: p.raven_prospect_id,
    google_place_id: p.google_place_id ?? null,
    normalized_business_name: p.normalized_business_name,
    normalized_address: p.normalized_address,
    normalized_website: p.normalized_website ?? null,
    phone: p.phone ?? null,
    email: p.email ?? null,
    restaurant_category: p.restaurant_category,
    menu_source_url: p.menu_source_url,
    menu_content_type: p.menu_content_type,
    menu_content_sha256: p.menu_content_sha256,
    menu_fetched_at: p.menu_fetched_at,
    idempotency_key: p.idempotency_key,
    event_type: p.event_type,
    occurred_at: p.occurred_at,
    source_payload_hash: p.source_payload_hash,
    provisioning_status: 'processing',
    attempt_count: 1,
  };
  const { data: row, error } = await db.from('raven_provisioning_requests').insert(record as never).select('*').single();
  if (error || !row) {
    // A concurrent winner committed between the read and the insert. Re-run
    // the SAME identity test rather than only re-reading the idempotency key:
    // the race can be lost to a different prospect on the place or
    // name/address index, and that is a conflict, not a retry.
    const winner = await findExisting(db, p);
    if (winner) return settleIdentity(winner, p);
    return fail('duplicate_identity', 'a provisioning request already exists for this restaurant', false, 409);
  }
  try {
    const staged = await parseAndStage({ content: p.menu_content!, sourceUrl: p.menu_source_url!, nameHint: p.normalized_business_name, sampleMenu: p.sample_menu });
    const claimUrl = buildClaimUrl(staged.slug, staged.claimToken);
    // parseAndStage issues a 14-day claim token by default. Persist the
    // corresponding safe operator metadata alongside the durable success so
    // retries and the downstream handoff can identify the exact preview
    // without staging a second tenant.
    const previewUrl = buildPreviewUrl(staged.tenantId);
    const expiresAt = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    const successPatch = {
      provisioning_status: 'succeeded',
      tenant_id: staged.tenantId,
      preview_id: staged.tenantId,
      preview_url: previewUrl,
      claim_url: claimUrl,
      expires_at: expiresAt,
      retryable: false,
      last_error: null,
      error_code: null,
      next_retry_at: null,
      updated_at: now.toISOString(),
    };
    const { data: updated } = await db.from('raven_provisioning_requests').update(successPatch as never).eq('id', row.id).select('*').single();
    return json(toResponse(updated ?? { ...row, provisioning_status: 'succeeded', tenant_id: staged.tenantId, claim_url: claimUrl }));
  } catch (e) {
    const retryable = !(e instanceof StagingError && ['no_menu', 'unparseable', 'invalid', 'conflict'].includes(e.reason));
    const { data: updated } = await db.from('raven_provisioning_requests').update({ provisioning_status: retryable ? 'failed' : 'exhausted', retryable, last_error: e instanceof Error ? e.message : 'provisioning failed', error_code: e instanceof StagingError ? e.reason : 'provisioning_error', next_retry_at: retryable ? new Date(now.getTime() + 60_000).toISOString() : null } as never).eq('id', row.id).select('*').single();
    return json(toResponse(updated ?? row), retryable ? 503 : 422);
  }
}
type MatchedRow = { row: Record<string, unknown>; matchedOn: 'idempotency_key' | 'raven_prospect_id' | 'google_place_id' | 'normalized_identity' };

/**
 * The row this restaurant already has, by any of the four unique keys the
 * migration enforces, in the order the contract lists them.
 *
 * Returns which key matched, because that is the difference between "you
 * already sent this" and "somebody else is already this restaurant".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findExisting(db: any, p: RavenProvisionRequest): Promise<MatchedRow | null> {
  const base = () => db.from('raven_provisioning_requests').select('*').eq('source_system', 'raven');

  const byIdempotency = (await base().eq('idempotency_key', p.idempotency_key).maybeSingle()).data;
  if (byIdempotency) return { row: byIdempotency, matchedOn: 'idempotency_key' };

  const byProspect = (await base().eq('raven_prospect_id', p.raven_prospect_id).maybeSingle()).data;
  if (byProspect) return { row: byProspect, matchedOn: 'raven_prospect_id' };

  if (p.google_place_id) {
    const byPlace = (await base().eq('google_place_id', p.google_place_id).maybeSingle()).data;
    if (byPlace) return { row: byPlace, matchedOn: 'google_place_id' };
  }

  const byIdentity = (
    await base()
      .eq('normalized_business_name', p.normalized_business_name)
      .eq('normalized_address', p.normalized_address)
      .maybeSingle()
  ).data;
  if (byIdentity) return { row: byIdentity, matchedOn: 'normalized_identity' };

  return null;
}

/**
 * Same prospect, or a different one wearing the same restaurant?
 *
 * One test decides it, whichever key matched: a row belonging to the SAME
 * `raven_prospect_id` is this caller's own earlier request, so it gets the
 * stored result. A row belonging to a DIFFERENT prospect means two Raven
 * prospects resolved to one restaurant — a permanent conflict for the source
 * system to reconcile, never something to retry and never something to
 * overwrite. The stored row is read and returned as-is; nothing is mutated.
 */
function settleIdentity(found: MatchedRow, p: RavenProvisionRequest): NextResponse {
  if (String(found.row.raven_prospect_id) === p.raven_prospect_id) return json(toResponse(found.row));
  return json(
    {
      error_code: 'duplicate_identity',
      error_message: `this restaurant is already provisioned under a different Raven prospect (matched on ${found.matchedOn})`,
      retryable: false,
      conflicting_field: found.matchedOn,
    },
    409,
  );
}

function toResponse(row: Record<string, unknown>): RavenProvisionResponse {
  return {
    request_id: String(row.id),
    source_system: 'raven',
    raven_prospect_id: String(row.raven_prospect_id),
    idempotency_key: String(row.idempotency_key),
    ordering_tenant_id: row.tenant_id ? String(row.tenant_id) : null,
    preview_id: row.preview_id ? String(row.preview_id) : null,
    claim_url: row.claim_url ? String(row.claim_url) : null,
    preview_url: row.preview_url ? String(row.preview_url) : null,
    provisioning_status: row.provisioning_status as RavenProvisionResponse['provisioning_status'],
    expires_at: row.expires_at ? String(row.expires_at) : null,
    retryable: Boolean(row.retryable),
    error_code: row.error_code ? String(row.error_code) : null,
    error_message: row.last_error ? String(row.last_error) : null,
  };
}

// NOTE FOR RAVEN: Interpret responses by BOTH criteria together:
// - HTTP 200 + provisioning_status='succeeded' + ordering_tenant_id != null = SUCCESS
// - HTTP 200 + provisioning_status!='succeeded' OR ordering_tenant_id=null = PROVISIONING FAILED (may be retryable)
// - HTTP 503 = FAILED, RETRYABLE
// - HTTP 422 = FAILED, NOT RETRYABLE
// Do NOT treat HTTP 200 as success if provisioning_status is not 'succeeded'.
