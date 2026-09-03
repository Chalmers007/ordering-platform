import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { POST } from './route';

/**
 * End-to-end through the REAL route handler: bearer auth, schema validation,
 * the structured parser, and — for the non-dry path — the local database.
 *
 * Nothing is mocked except the calendar. The claims under test are the ones
 * that decide whether a scraped menu can take somebody's money.
 */
const SECRET = 'e'.repeat(48);
const URL_BASE = 'http://admin.localhost:3005/api/admin/provision-from-scraper';

const RESTAURANT = {
  '@context': 'https://schema.org',
  '@type': 'Restaurant',
  name: 'Copper Pot Route Test',
  servesCuisine: 'Southern',
  logo: 'https://cdn.example/logo.png',
  hasMenu: {
    '@type': 'Menu',
    hasMenuSection: [{
      '@type': 'MenuSection', name: 'Mains',
      hasMenuItem: [
        { '@type': 'MenuItem', name: 'Gumbo RT', description: 'Andouille and okra', offers: { price: '12.99' } },
        { '@type': 'MenuItem', name: 'Catfish RT', offers: { price: 18 } },
        { '@type': 'MenuItem', name: 'Snapper RT', offers: { price: 'market price' } },
      ],
    }],
  },
};

const page = `<script type="application/ld+json">${JSON.stringify(RESTAURANT)}</script>`;

const post = (body: unknown, opts: { secret?: string | null; dryRun?: boolean } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret !== null) headers.Authorization = `Bearer ${opts.secret ?? SECRET}`;
  return POST(new Request(`${URL_BASE}${opts.dryRun ? '?dryRun=1' : ''}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }) as never);
};

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const created: string[] = [];

beforeAll(() => {
  // Vitest does not read .env.local, and this suite talks to the real local
  // database. Loaded here rather than in a global setup file so the rest of the
  // suite keeps running without credentials.
  process.loadEnvFile('.env.local');
  process.env.PROVISION_BRIDGE_SECRET = SECRET;
});
afterAll(async () => {
  const c = db();
  for (const id of created) {
    await c.from('menu_items').delete().eq('tenant_id', id);
    await c.from('menu_categories').delete().eq('tenant_id', id);
    await c.from('webhook_events').delete().eq('tenant_id', id);
    await c.from('tenants').delete().eq('id', id);
  }
});

describe('bridge auth', () => {
  it('refuses a caller presenting the wrong secret', async () => {
    // A wrong secret is 403 and returns before the session guard is consulted.
    expect((await post({ content: page, sourceUrl: 'https://x.example' }, { secret: 'q'.repeat(48), dryRun: true })).status).toBe(403);
  });

  // The no-credential case falls through to requireSuperAdmin, which reads
  // cookies() and can only run inside a Next request scope. Its behaviour is
  // covered where it can be: bridge-secret.test.ts for the comparison, and the
  // guard returns 401 from that path by inspection.

  it('refuses everyone when no secret is configured', async () => {
    const saved = process.env.PROVISION_BRIDGE_SECRET;
    delete process.env.PROVISION_BRIDGE_SECRET;
    try {
      // Fails closed. A missing env var must not open the door.
      expect((await post({ content: page, sourceUrl: 'https://x.example' }, { dryRun: true })).status).toBe(403);
    } finally { process.env.PROVISION_BRIDGE_SECRET = saved; }
  });
});

describe('dry run', () => {
  it('parses and reports without creating anything', async () => {
    // Scoped to this restaurant's own slug. Counting every tenant made the
    // assertion fail whenever another suite created one in parallel — a flaw
    // in the test, not in the dry run.
    const slug = 'copper-pot-route-test';
    const before = await db().from('tenants').select('id', { count: 'exact', head: true }).eq('slug', slug);
    const res = await post({ content: page, sourceUrl: 'https://copperpot.example/menu' }, { dryRun: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.parsedBy).toBe('structured');
    expect(body.name).toBe('Copper Pot Route Test');

    // $12.99 -> 1299, and 18 -> 1800. Integer cents, never a float.
    const gumbo = body.preview.find((p: { name: string }) => p.name === 'Gumbo RT');
    expect(gumbo.priceCents).toBe(1299);
    expect(body.preview.find((p: { name: string }) => p.name === 'Catfish RT').priceCents).toBe(1800);

    // "market price" is dropped, not priced at zero.
    expect(body.preview.some((p: { name: string }) => p.name === 'Snapper RT')).toBe(false);
    expect(body.items).toBe(2);

    // A dry run hands back no ownership credential, and writes no tenant.
    expect(body.claimUrl).toBeUndefined();
    expect(body.tenantId).toBeUndefined();
    const after = await db().from('tenants').select('id', { count: 'exact', head: true }).eq('slug', slug);
    expect(after.count).toBe(before.count);
  });

  it('reports a page that is not a menu as 422, not a server fault', async () => {
    const res = await post({ content: '<html><body>Closed for renovation</body></html>', sourceUrl: 'https://x.example' }, { dryRun: true });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe('no_menu');
  });

  it('rejects a malformed body before it reaches the parser', async () => {
    expect((await post({ sourceUrl: 'not-a-url' }, { dryRun: true })).status).toBe(400);
    expect((await post({ content: '', sourceUrl: 'https://x.example' }, { dryRun: true })).status).toBe(400);
  });
});

describe('staging a real storefront', () => {
  it('creates a claim-gated tenant whose menu cannot be ordered', async () => {
    const res = await post({ content: page, sourceUrl: 'https://copperpot.example/menu' });
    const body = await res.json();
    expect(res.status).toBe(201);
    created.push(body.tenantId);

    expect(body.claimUrl).toMatch(/\/claim\?token=[0-9a-f-]{36}$/);
    expect(body.menuVerified).toBe(false);
    expect(body.items).toBe(2);

    const c = db();
    const { data: tenant } = await c.from('tenants').select('status, menu_verified_at, claim_token').eq('id', body.tenantId).single();
    // Ownership gate: pending_claim is hidden from anon by the RLS policy.
    expect(tenant!.status).toBe('pending_claim');
    // Accuracy gate: unset until a human confirms the menu.
    expect(tenant!.menu_verified_at).toBeNull();
    expect(tenant!.claim_token).not.toBeNull();

    const { data: items } = await c.from('menu_items').select('name, price_cents, is_available, source, source_url').eq('tenant_id', body.tenantId);
    expect(items).toHaveLength(2);
    for (const item of items!) {
      // The database forced this, not the caller.
      expect(item.is_available).toBe(false);
      expect(item.source).toBe('scraped');
      expect(item.source_url).toBe('https://copperpot.example/menu');
    }
    expect(items!.find((i) => i.name === 'Gumbo RT')!.price_cents).toBe(1299);

    // And the CRM was told a storefront exists.
    const { data: hooks } = await c.from('webhook_events').select('event_type').eq('tenant_id', body.tenantId);
    expect(hooks!.map((h) => h.event_type)).toContain('tenant.provisioned');
  });

  it('returns no preview_url, because a staged storefront has no public page', async () => {
    const res = await post({ content: page.replace(/Copper Pot Route Test/, 'Second Pot RT'), sourceUrl: 'https://second.example/menu' });
    const body = await res.json();
    created.push(body.tenantId);
    // The claim link is the ONLY way in while the tenant is unclaimed. There is
    // deliberately no readable preview URL to hand to outreach.
    expect(body.preview_url).toBeUndefined();
    expect(body.previewUrl).toBeUndefined();
    expect(body.claimUrl).toBeTruthy();
  });
});

describe('a name that is already taken', () => {
  it('is a 409, not a 500 — the menu was fine and the name is the problem', async () => {
    // provision_tenant refuses rather than overwriting, which is what stops a
    // second run clobbering a storefront somebody may already hold a claim
    // link for. Reporting that as a server fault sends an operator hunting an
    // outage instead of looking up the existing storefront.
    const first = await post({ content: page.replace(/Copper Pot Route Test/g, 'Collision Test Cafe'), sourceUrl: 'https://collide.example/menu' });
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    created.push(firstBody.tenantId);

    const second = await post({ content: page.replace(/Copper Pot Route Test/g, 'Collision Test Cafe'), sourceUrl: 'https://collide.example/menu' });
    const body = await second.json();
    expect(second.status).toBe(409);
    expect(body.reason).toBe('conflict');
    expect(body.error).toMatch(/already exists/i);
  });
});
