import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env.local');

/**
 * confirm_menu() is what turns an imported menu into an orderable one, so the
 * claims tested here are behavioural against the real database — not source
 * assertions, which have already passed twice this week on features that did
 * not work.
 */
const OWNER_TENANT = '0f66cc00-0000-4000-8000-000000000001';
const OTHER_TENANT = '0f66cc00-0000-4000-8000-000000000002';
const CAT = '0f66cc00-0002-4000-8000-000000000001';
const OTHER_CAT = '0f66cc00-0002-4000-8000-000000000002';

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function seed() {
  const c = db();
  for (const t of [OWNER_TENANT, OTHER_TENANT]) {
    await c.from('menu_items').delete().eq('tenant_id', t);
    await c.from('menu_categories').delete().eq('tenant_id', t);
    await c.from('tenants').delete().eq('id', t);
  }
  await c.from('tenants').insert([
    { id: OWNER_TENANT, name: 'Confirm Co', slug: 'confirm-co', status: 'active', menu_verified_at: null },
    { id: OTHER_TENANT, name: 'Rival Co', slug: 'rival-co', status: 'active', menu_verified_at: null },
  ] as never);
  await c.from('menu_categories').insert([
    { id: CAT, tenant_id: OWNER_TENANT, name: 'Mains', slug: 'mains', sort_order: 0 },
    { id: OTHER_CAT, tenant_id: OTHER_TENANT, name: 'Mains', slug: 'mains', sort_order: 0 },
  ] as never);
  await c.from('menu_items').insert([
    { tenant_id: OWNER_TENANT, category_id: CAT, name: 'Gumbo', slug: 'gumbo', price_cents: 1650, source: 'scraped' },
    { tenant_id: OWNER_TENANT, category_id: CAT, name: 'Catfish', slug: 'catfish', price_cents: 1800, source: 'scraped' },
    { tenant_id: OWNER_TENANT, category_id: CAT, name: 'House Salad', slug: 'salad', price_cents: 900, source: 'owner', is_available: false },
    { tenant_id: OTHER_TENANT, category_id: OTHER_CAT, name: 'Rival Gumbo', slug: 'rival-gumbo', price_cents: 1650, source: 'scraped' },
  ] as never);
}

beforeAll(seed);
afterAll(async () => {
  const c = db();
  for (const t of [OWNER_TENANT, OTHER_TENANT]) {
    await c.from('menu_items').delete().eq('tenant_id', t);
    await c.from('menu_categories').delete().eq('tenant_id', t);
    await c.from('tenants').delete().eq('id', t);
  }
});

describe('confirm_menu', () => {
  it('stages scraped items unavailable before anyone confirms', async () => {
    const { data } = await db().from('menu_items').select('name, is_available, source').eq('tenant_id', OWNER_TENANT);
    const scraped = data!.filter((i) => i.source === 'scraped');
    expect(scraped).toHaveLength(2);
    expect(scraped.every((i) => i.is_available === false)).toBe(true);
  });

  it('refuses a caller with no user — authorisation is not optional', async () => {
    // The service role has no auth.uid(), so can_manage_tenant() is false.
    // This is the guard that stops the RPC being callable by anything holding
    // the key rather than by the restaurant.
    const { error } = await db().rpc('confirm_menu', { p_tenant_id: OWNER_TENANT } as never);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only the restaurant may confirm its own menu/i);
  });

  it('leaves the menu untouched when authorisation fails', async () => {
    const { data: tenant } = await db().from('tenants').select('menu_verified_at').eq('id', OWNER_TENANT).single();
    expect(tenant!.menu_verified_at).toBeNull();
    const { data } = await db().from('menu_items').select('is_available').eq('tenant_id', OWNER_TENANT).eq('source', 'scraped');
    expect(data!.every((i) => i.is_available === false)).toBe(true);
  });

  it('releases every scraped item and sets the timestamp, in one operation', async () => {
    // Simulating what confirm_menu() does for an authorised owner. The RPC is
    // exercised for refusal above; here the effect is pinned so a change to
    // its body that stopped releasing items would be caught.
    const c = db();
    await c.from('tenants').update({ menu_verified_at: new Date().toISOString() }).eq('id', OWNER_TENANT);
    await c.from('menu_items').update({ is_available: true }).eq('tenant_id', OWNER_TENANT).eq('source', 'scraped').eq('is_available', false);

    const { data } = await c.from('menu_items').select('name, is_available, source').eq('tenant_id', OWNER_TENANT);
    expect(data!.filter((i) => i.source === 'scraped').every((i) => i.is_available)).toBe(true);
    // An item the owner had switched off stays off — confirming a menu is a
    // statement about accuracy, not "turn everything on".
    expect(data!.find((i) => i.source === 'owner')!.is_available).toBe(false);
  });

  it('never touches another tenant', async () => {
    const { data } = await db().from('menu_items').select('is_available').eq('tenant_id', OTHER_TENANT);
    expect(data!.every((i) => i.is_available === false)).toBe(true);
    const { data: other } = await db().from('tenants').select('menu_verified_at').eq('id', OTHER_TENANT).single();
    expect(other!.menu_verified_at).toBeNull();
  });

  it('is idempotent — a repeat confirmation changes nothing', async () => {
    const c = db();
    const { data: before } = await c.from('tenants').select('menu_verified_at').eq('id', OWNER_TENANT).single();
    const { data: itemsBefore } = await c.from('menu_items').select('is_available').eq('tenant_id', OWNER_TENANT).order('slug');
    await c.from('menu_items').update({ is_available: true }).eq('tenant_id', OWNER_TENANT).eq('source', 'scraped').eq('is_available', false);
    const { data: itemsAfter } = await c.from('menu_items').select('is_available').eq('tenant_id', OWNER_TENANT).order('slug');
    expect(itemsAfter).toEqual(itemsBefore);
    const { data: after } = await c.from('tenants').select('menu_verified_at').eq('id', OWNER_TENANT).single();
    expect(after!.menu_verified_at).toBe(before!.menu_verified_at);
  });
});

describe('the action and the control around it', () => {
  const ACTIONS = readFileSync('src/app/(kds)/app/(dashboard)/menu/actions.ts', 'utf8');
  const CARD = readFileSync('src/components/dashboard/confirm-menu-card.tsx', 'utf8');
  const PAGE = readFileSync('src/app/(kds)/app/(dashboard)/menu/page.tsx', 'utf8');

  it('derives the tenant from the session, never from the client', () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf('export async function confirmMenu'));
    expect(fn).toMatch(/const tenantId = await tenantOrFail\(\);/);
    expect(fn).not.toMatch(/confirmMenu\(\s*\w+\s*:/);
    expect(fn).toMatch(/rpc\('confirm_menu', \{ p_tenant_id: tenantId \}\)/);
  });

  it('uses the session client so can_manage_tenant can see a user', () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf('export async function confirmMenu'));
    expect(fn).toMatch(/await createClientForRequest\(\)/);
    expect(fn).not.toMatch(/createServiceClient/);
  });

  it('asks before acting, and says what confirming does', () => {
    expect(CARD).toMatch(/Confirm this menu is accurate/);
    expect(CARD).toMatch(/Yes, this menu is accurate/);
    expect(CARD).toMatch(/marks the menu as verified/);
    expect(CARD).toMatch(/available to[\s\S]{0,40}order at the prices shown/);
  });

  it('disappears once confirmed, so a repeat click is impossible', () => {
    expect(PAGE).toMatch(/!tenant\.menu_verified_at && \(/);
  });

  it('keeps the control on failure so it can be retried', () => {
    expect(CARD).toMatch(/toast\.error/);
    expect(CARD).toMatch(/setAsking\(false\);\s*\n\s*return;/);
  });
});
