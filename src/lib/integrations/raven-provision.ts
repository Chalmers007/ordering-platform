import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const RAVEN_SOURCE = 'raven' as const;
export const REPLAY_WINDOW_SECONDS = 300;

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
  menu_content: z.string().max(500_000).optional(),
});
export type RavenProvisionRequest = z.infer<typeof ravenProvisionSchema>;

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
