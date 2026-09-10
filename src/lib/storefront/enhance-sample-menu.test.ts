import { databaseTestsEnabled } from '../../../test-support/database-tests';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { enhanceSampleMenu } from './enhance-sample-menu';

const TENANT_ID = '0e55bb00-0000-4000-8000-000000000099';
const CAT_ID = '0e55bb00-0002-4000-8000-000000000099';

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

beforeAll(async () => {
  if (!databaseTestsEnabled) return;
  const c = db();

  // Clean up any existing test data
  await c.from('menu_item_modifier_groups').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_modifiers').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_modifier_groups').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_items').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_categories').delete().eq('tenant_id', TENANT_ID);
  await c.from('tenants').delete().eq('id', TENANT_ID);

  // Create test tenant
  await c.from('tenants').insert({
    id: TENANT_ID,
    name: 'Sample Menu Test Co',
    slug: `sample-menu-test-${Date.now()}`,
    status: 'pending_claim',
    timezone: 'America/New_York',
    currency: 'USD',
  } as never);

  // Create category
  await c.from('menu_categories').insert({
    id: CAT_ID,
    tenant_id: TENANT_ID,
    name: 'Mains',
    slug: 'mains',
    sort_order: 0,
  } as never);

  // Create sample menu items with various slugs
  await c.from('menu_items').insert([
    {
      tenant_id: TENANT_ID,
      category_id: CAT_ID,
      name: 'Classic Sandwich',
      slug: 'classic-sandwich',
      description: 'A delicious sandwich',
      price_cents: 1200,
      source: 'sample',
      is_available: false,
    },
    {
      tenant_id: TENANT_ID,
      category_id: CAT_ID,
      name: 'Beef Burger',
      slug: 'beef-burger',
      description: 'Premium beef burger',
      price_cents: 1400,
      source: 'sample',
      is_available: false,
    },
    {
      tenant_id: TENANT_ID,
      category_id: CAT_ID,
      name: 'Veggie Bowl',
      slug: 'veggie-bowl',
      description: 'Healthy vegetarian bowl',
      price_cents: 1000,
      source: 'sample',
      is_available: false,
    },
    {
      tenant_id: TENANT_ID,
      category_id: CAT_ID,
      name: 'Chicken Wrap',
      slug: 'chicken-wrap',
      description: 'Fresh wrap',
      price_cents: 1100,
      source: 'sample',
      is_available: false,
    },
  ] as never);
});

afterAll(async () => {
  if (!databaseTestsEnabled) return;
  const c = db();
  await c.from('menu_item_modifier_groups').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_modifiers').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_modifier_groups').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_items').delete().eq('tenant_id', TENANT_ID);
  await c.from('menu_categories').delete().eq('tenant_id', TENANT_ID);
  await c.from('tenants').delete().eq('id', TENANT_ID);
});

describe.skipIf(!databaseTestsEnabled)('enhanceSampleMenu', () => {
  it('creates modifier groups with correct configurations', async () => {
    const c = db();
    const result = await enhanceSampleMenu({ tenantId: TENANT_ID, db: c });

    expect(result.groupsCreated).toBeGreaterThan(0);
    expect(result.modifiersCreated).toBeGreaterThan(0);
    expect(result.itemsLinked).toBeGreaterThan(0);

    // Verify Size group was created
    const { data: sizeGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Size')
      .single();

    expect(sizeGroup).toBeDefined();
    expect(sizeGroup?.selection_type).toBe('single');
    expect(sizeGroup?.is_required).toBe(true);
    expect(sizeGroup?.min_selections).toBe(1);
    expect(sizeGroup?.max_selections).toBe(1);
  });

  it('creates size modifiers with price deltas', async () => {
    const c = db();

    const { data: sizeGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Size')
      .single();

    const { data: sizes } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('group_id', sizeGroup!.id)
      .order('sort_order');

    expect(sizes).toHaveLength(3);
    expect(sizes![0].name).toBe('Small');
    expect(sizes![0].price_delta_cents).toBe(0);
    expect(sizes![0].is_default).toBe(true);

    expect(sizes![1].name).toBe('Medium');
    expect(sizes![1].price_delta_cents).toBe(150);

    expect(sizes![2].name).toBe('Large');
    expect(sizes![2].price_delta_cents).toBe(300);
  });

  it('creates sauce group as optional single-choice', async () => {
    const c = db();

    const { data: sauceGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Sauce')
      .single();

    expect(sauceGroup).toBeDefined();
    expect(sauceGroup?.selection_type).toBe('single');
    expect(sauceGroup?.is_required).toBe(false);
    expect(sauceGroup?.min_selections).toBe(0);
    expect(sauceGroup?.max_selections).toBe(1);

    const { data: sauces } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('group_id', sauceGroup!.id)
      .order('sort_order');

    expect(sauces!.length).toBeGreaterThanOrEqual(3);
  });

  it('creates toppings group as optional multiple-choice with max', async () => {
    const c = db();

    const { data: toppingGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Toppings')
      .single();

    expect(toppingGroup).toBeDefined();
    expect(toppingGroup?.selection_type).toBe('multiple');
    expect(toppingGroup?.is_required).toBe(false);
    expect(toppingGroup?.max_selections).toBe(4);

    const { data: toppings } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('group_id', toppingGroup!.id)
      .order('sort_order');

    expect(toppings!.length).toBeGreaterThanOrEqual(4);
  });

  it('creates protein group with multiple options', async () => {
    const c = db();

    const { data: proteinGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Protein')
      .single();

    expect(proteinGroup).toBeDefined();
    expect(proteinGroup?.selection_type).toBe('single');
    expect(proteinGroup?.is_required).toBe(false);

    const { data: proteins } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('group_id', proteinGroup!.id)
      .order('sort_order');

    const names = proteins!.map((p) => p.name);
    expect(names).toContain('Chicken');
    expect(names).toContain('Beef');
    expect(names).toContain('Shrimp');
    expect(names).toContain('Vegetarian');
  });

  it('links modifiers to items based on slug patterns', async () => {
    const c = db();

    // Sandwich should have Size, Sauce, Toppings
    const { data: sandwich } = await c
      .from('menu_items')
      .select('id')
      .eq('slug', 'classic-sandwich')
      .single();

    const { data: sandwichModifiers } = (await c
      .from('menu_item_modifier_groups')
      .select('menu_modifier_groups(name)')
      .eq('item_id', sandwich!.id)
      .order('sort_order')) as {
      data: Array<{ menu_modifier_groups: { name: string } }> | null;
    };

    const sandwichGroups = sandwichModifiers!.map((m) => m.menu_modifier_groups.name);
    expect(sandwichGroups).toContain('Size');
    expect(sandwichGroups).toContain('Sauce');
    expect(sandwichGroups).toContain('Toppings');
  });

  it('links burger to Size, Toppings, Add-ons', async () => {
    const c = db();

    const { data: burger } = await c
      .from('menu_items')
      .select('id')
      .eq('slug', 'beef-burger')
      .single();

    const { data: burgerModifiers } = (await c
      .from('menu_item_modifier_groups')
      .select('menu_modifier_groups(name)')
      .eq('item_id', burger!.id)
      .order('sort_order')) as {
      data: Array<{ menu_modifier_groups: { name: string } }> | null;
    };

    const burgerGroups = burgerModifiers!.map((m) => m.menu_modifier_groups.name);
    expect(burgerGroups).toContain('Size');
    expect(burgerGroups).toContain('Toppings');
    expect(burgerGroups).toContain('Add-ons');
  });

  it('links bowl to Size, Protein, Sauce, Toppings', async () => {
    const c = db();

    const { data: bowl } = await c
      .from('menu_items')
      .select('id')
      .eq('slug', 'veggie-bowl')
      .single();

    const { data: bowlModifiers } = (await c
      .from('menu_item_modifier_groups')
      .select('menu_modifier_groups(name)')
      .eq('item_id', bowl!.id)
      .order('sort_order')) as {
      data: Array<{ menu_modifier_groups: { name: string } }> | null;
    };

    const bowlGroups = bowlModifiers!.map((m) => m.menu_modifier_groups.name);
    expect(bowlGroups).toContain('Size');
    expect(bowlGroups).toContain('Protein');
    expect(bowlGroups).toContain('Sauce');
    expect(bowlGroups).toContain('Toppings');
  });

  it('links wrap to Size, Sauce, Toppings', async () => {
    const c = db();

    const { data: wrap } = await c
      .from('menu_items')
      .select('id')
      .eq('slug', 'chicken-wrap')
      .single();

    const { data: wrapModifiers } = (await c
      .from('menu_item_modifier_groups')
      .select('menu_modifier_groups(name)')
      .eq('item_id', wrap!.id)
      .order('sort_order')) as {
      data: Array<{ menu_modifier_groups: { name: string } }> | null;
    };

    const wrapGroups = wrapModifiers!.map((m) => m.menu_modifier_groups.name);
    expect(wrapGroups).toContain('Size');
    expect(wrapGroups).toContain('Sauce');
    expect(wrapGroups).toContain('Toppings');
  });

  it('is idempotent: running twice on same tenant produces same result', async () => {
    const c = db();

    const result1 = await enhanceSampleMenu({ tenantId: TENANT_ID, db: c });
    const result2 = await enhanceSampleMenu({ tenantId: TENANT_ID, db: c });

    // Second run should create 0 new groups and modifiers (already exist)
    expect(result2.groupsCreated).toBe(0);
    expect(result2.modifiersCreated).toBe(0);
    // Items should not be re-linked (already linked)
    expect(result2.itemsLinked).toBe(0);
  });

  it('sample items remain unavailable', async () => {
    const c = db();

    const { data: items } = await c
      .from('menu_items')
      .select('is_available, source')
      .eq('tenant_id', TENANT_ID);

    for (const item of items || []) {
      expect(item.source).toBe('sample');
      expect(item.is_available).toBe(false);
    }
  });

  it('price delta updates match realistic restaurant customizations', async () => {
    const c = db();

    // Check that price deltas are realistic
    const { data: cheese } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Extra Cheese')
      .single();

    expect(cheese?.price_delta_cents).toBe(125);

    const { data: bacon } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Bacon')
      .single();

    expect(bacon?.price_delta_cents).toBe(175);

    const { data: garlicBread } = await c
      .from('menu_modifiers')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Garlic Bread')
      .single();

    expect(garlicBread?.price_delta_cents).toBe(200);
  });

  it('required vs optional groups are clearly labeled', async () => {
    const c = db();

    const { data: sizeGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Size')
      .single();

    const { data: sauceGroup } = await c
      .from('menu_modifier_groups')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('name', 'Sauce')
      .single();

    expect(sizeGroup?.is_required).toBe(true);
    expect(sauceGroup?.is_required).toBe(false);
  });
});
