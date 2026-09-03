import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Loaded at module scope: createServiceClient() reads these when the module
// under test is first evaluated, which happens before beforeAll runs.
process.loadEnvFile('.env.local');
import { createClient } from '@supabase/supabase-js';

// NOT a static import: @/lib/supabase/server reads its env at module scope,
// and ES imports are hoisted above the loadEnvFile below — so importing the
// loader statically evaluates it before the environment exists.
type LoadStorefront = typeof import('./data').loadStorefront;
let loadStorefront: LoadStorefront;

/**
 * Behavioural, against the real local database.
 *
 * The source-assertion tests beside this one passed twice while the feature
 * rendered a blank page: RLS hides an unclaimed tenant from the anon role, and
 * no amount of grepping the middleware for the right string catches that. This
 * calls the loader the way the page does and looks at what comes back.
 */
const TENANT = '0e55bb00-0000-4000-8000-000000000009';
const CAT = '0e55bb00-0002-4000-8000-000000000009';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

beforeAll(async () => {
  ({ loadStorefront } = await import('./data'));
  const db = admin();
  await db.from('menu_items').delete().eq('tenant_id', TENANT);
  await db.from('menu_categories').delete().eq('tenant_id', TENANT);
  await db.from('tenants').delete().eq('id', TENANT);
  await db.from('tenants').insert({ id: TENANT, name: 'Preview Behaviour Co', slug: 'preview-behaviour-co', status: 'pending_claim', menu_verified_at: new Date().toISOString() } as never);
  await db.from('menu_categories').insert({ id: CAT, tenant_id: TENANT, name: 'Mains', slug: 'mains', sort_order: 0 } as never);
  await db.from('menu_items').insert({ tenant_id: TENANT, category_id: CAT, name: 'Gumbo', slug: 'gumbo', price_cents: 1650, is_available: true, source: 'owner' } as never);
});

afterAll(async () => {
  const db = admin();
  await db.from('menu_items').delete().eq('tenant_id', TENANT);
  await db.from('menu_categories').delete().eq('tenant_id', TENANT);
  await db.from('tenants').delete().eq('id', TENANT);
});

describe('loading an unclaimed storefront', () => {
  it('returns the menu when loaded as a preview', async () => {
    const store = await loadStorefront(TENANT, { preview: true });
    expect(store).not.toBeNull();
    expect(store!.tenant.status).toBe('pending_claim');
    const items = store!.categories.flatMap((c) => c.menu_items ?? []);
    expect(items.map((i) => i.name)).toContain('Gumbo');
    expect(items.find((i) => i.name === 'Gumbo')!.price_cents).toBe(1650);
  });

  it('never returns a claim token or any credential field', async () => {
    // The preview reads through the service role, so what it SELECTS is the
    // only thing protecting the token. `tenants` is narrowed by column list.
    const store = await loadStorefront(TENANT, { preview: true });
    const serialised = JSON.stringify(store);
    for (const forbidden of ['claim_token', 'claim_token_expires_at', 'stripe_', 'service_role', 'secret']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(Object.keys(store!.tenant).sort()).toEqual(['currency', 'id', 'name', 'slug', 'status', 'timezone']);
  });
});
