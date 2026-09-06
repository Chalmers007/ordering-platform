import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const RAVEN_SOURCE = 'raven' as const;
export const REPLAY_WINDOW_SECONDS = 300;
export const MAX_MENU_CONTENT_CHARS = 500_000;
export const MENU_MAX_AGE_SECONDS = 24 * 60 * 60;
export const MENU_CONTENT_TYPES = ['text/html', 'text/plain', 'application/json'] as const;

export const ravenProvisionSchema = z.object({
  version: z.literal('1'), source_system: z.literal(RAVEN_SOURCE),
  raven_prospect_id: z.string().uuid(), idempotency_key: z.string().min(8).max(200),
  event_type: z.string().min(1).max(80), occurred_at: z.string().datetime({ offset: true }),
  google_place_id: z.string().max(300).nullable().optional(),
  normalized_business_name: z.string().min(1).max(200), normalized_address: z.string().min(1).max(500),
  normalized_website: z.string().url().max(2048).nullable().optional(),
  phone: z.string().max(40).nullable().optional(), email: z.string().email().max(320).nullable().optional(),
  restaurant_category: z.string().min(1).max(120), source_payload_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  /** Optional raw menu payload; required when this request performs staging. */
  menu_source_url: z.string().url().refine((u) => u.startsWith('https://'), 'menu source must use HTTPS').max(2048).optional(),
  menu_content: z.string().min(1).max(MAX_MENU_CONTENT_CHARS).optional(),
  menu_content_type: z.enum(MENU_CONTENT_TYPES).optional(),
  menu_content_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  menu_fetched_at: z.string().datetime({ offset: true }).optional(),
  /**
   * Explicit sample-menu flag for demo storefronts.
   * When true, indicates this is a polished sample menu for demonstration.
   * The receiver marks all items as source='sample' and keeps the storefront non-orderable.
   */
  sample_menu: z.boolean().optional(),
});
export type RavenProvisionRequest = z.infer<typeof ravenProvisionSchema>;

export function validateMenu(input: Pick<RavenProvisionRequest, 'menu_source_url' | 'menu_content' | 'menu_content_type' | 'menu_content_sha256' | 'menu_fetched_at'>, now = Date.now()): string | null {
  if (!input.menu_source_url || !input.menu_content || !input.menu_content_type || !input.menu_content_sha256 || !input.menu_fetched_at) return 'menu_required';
  if (bodyHash(input.menu_content) !== input.menu_content_sha256.toLowerCase()) return 'menu_hash_mismatch';
  const fetched = Date.parse(input.menu_fetched_at);
  if (!Number.isFinite(fetched) || fetched > now + 5 * 60_000 || now - fetched > MENU_MAX_AGE_SECONDS * 1000) return 'stale_menu';
  return null;
}

/**
 * The claim link, on the restaurant's OWN storefront host.
 *
 * It previously pointed at `admin.<root>/claim`, which cannot serve it: the
 * claim-route bypass in proxy.ts lives only in the storefront surface case,
 * so on the admin host an unauthenticated prospect is redirected to /login
 * and an authenticated one is rewritten to /admin/claim, which does not
 * exist. `/api/claim` also compares the redeeming tenant against the host's
 * resolved tenant precisely so a leaked token cannot be spent anywhere else
 * — a check that only has meaning on the tenant's own subdomain.
 *
 * Returns null when no root domain is configured, so a misconfigured
 * deployment reports "no claim link" rather than inventing a broken one.
 */
export function buildClaimUrl(
  slug: string,
  token: string,
  root: string | undefined = process.env.NEXT_PUBLIC_ROOT_DOMAIN,
): string | null {
  if (!root) return null;
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${slug}.${root}/claim?token=${encodeURIComponent(token)}`;
}

export type RavenProvisionResponse = {
  request_id: string; source_system: 'raven'; raven_prospect_id: string; idempotency_key: string;
  ordering_tenant_id: string | null; preview_id: string | null; claim_url: string | null; preview_url: string | null;
  provisioning_status: 'processing' | 'succeeded' | 'failed' | 'exhausted'; expires_at: string | null;
  retryable: boolean; error_code: string | null; error_message: string | null;
};

export function bodyHash(body: string): string { return createHash('sha256').update(body).digest('hex'); }

/** Canonical signing string: v1\\nsource\\ntimestamp\\nnonce\\nkey-id\\nmethod\\npath\\nsha256(body). */
export function canonicalRequest(input: { source: string; timestamp: string; nonce: string; keyId: string; method: string; path: string; body: string }): string {
  return ['v1', input.source, input.timestamp, input.nonce, input.keyId, input.method.toUpperCase(), input.path, bodyHash(input.body)].join('\n');
}
export function signRequest(input: Parameters<typeof canonicalRequest>[0], secret: string): string {
  return createHmac('sha256', secret).update(canonicalRequest(input)).digest('base64url');
}
export function signaturesEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function parseKeyRing(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const ring = new Map<string, string>();
  try { const parsed = JSON.parse(env.RAVEN_PROVISION_KEYS ?? '{}') as Record<string, unknown>; for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && v.length >= 32) ring.set(k, v); } catch { /* fail closed */ }
  const legacy = env.RAVEN_PROVISION_SECRET?.trim(); const keyId = env.RAVEN_PROVISION_KEY_ID?.trim() || 'current';
  if (legacy && legacy.length >= 32) ring.set(keyId, legacy);
  return ring;
}
