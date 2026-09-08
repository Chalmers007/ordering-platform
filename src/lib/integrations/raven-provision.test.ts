import { describe, expect, it } from 'vitest';
import { bodyHash, buildClaimUrl, canonicalRequest, parseKeyRing, ravenProvisionSchema, signRequest, signaturesEqual, validateMenu } from './raven-provision';

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
    const menu = '<html><body>Ramen $12.00</body></html>';
    const now = new Date().toISOString();
    const valid = ravenProvisionSchema.parse({ version: '1', source_system: 'raven', raven_prospect_id: '00000000-0000-4000-8000-000000000001', idempotency_key: 'event-12345678', event_type: 'restaurant.provision_requested', occurred_at: now, google_place_id: 'ChIJ1', normalized_business_name: 'Nowhere Noodle House', normalized_address: '404 Imaginary Ave, Testburg, ZZ', normalized_website: 'https://nowhere-noodle.example.test', phone: '+19045551212', email: 'owner@nowhere-noodle.example.test', restaurant_category: 'noodles', source_payload_hash: 'a'.repeat(64), menu_source_url: 'https://nowhere-noodle.example.test/menu', menu_content: menu, menu_content_type: 'text/html', menu_content_sha256: bodyHash(menu), menu_fetched_at: now });
    expect(valid.source_system).toBe('raven');
    expect(ravenProvisionSchema.safeParse({ ...valid, source_system: 'other' }).success).toBe(false);
    expect(ravenProvisionSchema.safeParse({ ...valid, source_payload_hash: 'bad' }).success).toBe(false);
    expect(ravenProvisionSchema.safeParse({ ...valid, menu_source_url: 'http://nowhere-noodle.example.test/menu' }).success).toBe(false);
    expect(ravenProvisionSchema.safeParse({ ...valid, menu_content_type: 'application/xml' }).success).toBe(false);
    expect(ravenProvisionSchema.safeParse({ ...valid, menu_content_sha256: 'b'.repeat(64) }).success).toBe(true); // hash verification is performed by validateMenu
    expect(validateMenu(valid)).toBeNull();
    expect(validateMenu({ ...valid, menu_content_sha256: 'b'.repeat(64) })).toBe('menu_hash_mismatch');
    expect(validateMenu({ ...valid, menu_fetched_at: '2020-01-01T00:00:00Z' })).toBe('stale_menu');
    // The 500,000-character cap is enforced by the schema, not by
    // validateMenu. Asserting it through validateMenu only ever observed a
    // hash mismatch, which is why the limit itself went untested.
    expect(ravenProvisionSchema.safeParse({ ...valid, menu_content: 'x'.repeat(500_001) }).success).toBe(false);
    expect(ravenProvisionSchema.safeParse({ ...valid, menu_content: '' }).success).toBe(false);
  });
});

describe('buildClaimUrl', () => {
  it("addresses the restaurant's own storefront host", () => {
    expect(buildClaimUrl('nowhere-noodle-house', 'tok-1', 'order.example.test')).toBe(
      'https://nowhere-noodle-house.order.example.test/claim?token=tok-1',
    );
  });

  it('never addresses the admin host, which cannot serve a claim', () => {
    const url = buildClaimUrl('nowhere-noodle-house', 'tok-1', 'order.example.test');
    expect(url).not.toContain('admin.');
    expect(url).not.toContain('/admin/');
  });

  it('uses http only for a localhost root', () => {
    expect(buildClaimUrl('demo', 't', 'localhost:3000')).toBe('http://demo.localhost:3000/claim?token=t');
  });

  it('returns null rather than inventing a link when no root domain is configured', () => {
    expect(buildClaimUrl('demo', 't', undefined)).toBeNull();
    expect(buildClaimUrl('demo', 't', '')).toBeNull();
  });

  it('escapes the token', () => {
    expect(buildClaimUrl('demo', 'a b&c', 'order.example.test')).toContain('token=a%20b%26c');
  });
});

describe('the claim url is routable', () => {
  it('resolves to the storefront surface, which is the only one that serves /claim', async () => {
    const { resolveHost } = await import('@/lib/tenancy/host');
    const url = new URL(buildClaimUrl('nowhere-noodle-house', 'tok-1', 'order.example.test')!);
    const resolution = resolveHost(url.host, 'order.example.test');
    expect(resolution.surface).toBe('storefront');
    expect(resolution).toMatchObject({ slug: 'nowhere-noodle-house' });
    expect(url.pathname).toBe('/claim');
  });

  it('the admin host it used to target resolves to a surface with no claim route', async () => {
    const { resolveHost } = await import('@/lib/tenancy/host');
    // Kept as a guard: proxy.ts honours isClaimRoute only inside the
    // storefront case, and src/app/(admin)/admin/ has no claim page, so an
    // admin-host claim link is a redirect to /login or a 404 — never a claim.
    expect(resolveHost('admin.order.example.test', 'order.example.test').surface).toBe('admin');
  });
});
