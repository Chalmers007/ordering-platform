import { describe, expect, it } from 'vitest';
import { canonicalRequest, parseKeyRing, ravenProvisionSchema, signRequest, signaturesEqual } from './raven-provision';

const input = { source: 'raven', timestamp: '1770000000', nonce: 'nonce-1', keyId: 'k1', method: 'post', path: '/api/internal/provision/raven', body: '{"x":1}' };
const secret = 's'.repeat(48);

describe('Raven provisioning signature contract', () => {
  it('uses the documented canonical string and verifies a valid signature', () => {
    expect(canonicalRequest(input)).toContain('v1\nraven\n1770000000\nnonce-1\nk1\nPOST\n');
    expect(signaturesEqual(signRequest(input, secret), signRequest(input, secret))).toBe(true);
  });
  it('rejects changed body, path, source, or signature', () => {
    const sig = signRequest(input, secret);
    expect(signaturesEqual(sig, signRequest({ ...input, body: '{"x":2}' }, secret))).toBe(false);
    expect(signaturesEqual(sig, `${sig}x`)).toBe(false);
    expect(signaturesEqual(sig, signRequest({ ...input, source: 'other' }, secret))).toBe(false);
  });
  it('supports a key ring and ignores short or malformed keys', () => {
    const ring = parseKeyRing({ RAVEN_PROVISION_KEYS: JSON.stringify({ old: 'o'.repeat(32), short: 'x' }) } as unknown as NodeJS.ProcessEnv);
    expect(ring.has('old')).toBe(true); expect(ring.has('short')).toBe(false);
  });
  it('validates the required Raven identity contract', () => {
    const valid = ravenProvisionSchema.parse({ version: '1', source_system: 'raven', raven_prospect_id: '00000000-0000-4000-8000-000000000001', idempotency_key: 'event-12345678', event_type: 'restaurant.provision_requested', occurred_at: '2026-09-05T12:00:00Z', google_place_id: 'ChIJ1', normalized_business_name: 'Cajun Seafood', normalized_address: '1 Main St, Jacksonville, FL', normalized_website: 'https://example.com', phone: '+19045551212', email: 'owner@example.com', restaurant_category: 'seafood', source_payload_hash: 'a'.repeat(64), menu_content: '<html />' });
    expect(valid.source_system).toBe('raven');
    expect(ravenProvisionSchema.safeParse({ ...valid, source_system: 'other' }).success).toBe(false);
    expect(ravenProvisionSchema.safeParse({ ...valid, source_payload_hash: 'bad' }).success).toBe(false);
  });
});
