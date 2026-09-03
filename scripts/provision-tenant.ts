/**
 * Provision a tenant directly against a Supabase project.
 *
 *   node --env-file=.env.production.local scripts/provision-tenant.ts \
 *     --name "Vardr Demo" --slug demo
 *
 * This is the bootstrap path, not the normal one. Normally a restaurant is
 * created through POST /api/admin/tenants, which calls provision_tenant()
 * — but that RPC checks is_super_admin(), and the service role has no
 * auth.uid(), so it cannot be used before the first administrator exists.
 * Hence a direct service-role insert.
 *
 * Idempotent on slug.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const name = arg('--name') ?? 'Vardr Demo';
const slug = (arg('--slug') ?? 'demo').toLowerCase();

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});


// ---------------------------------------------------------------------
// Menu definition
//
// Money is integer cents throughout, matching the schema. Storing a
// price_delta as 2.50 would put floating point in the middle of a payment
// split; the database refuses it for the same reason.
// ---------------------------------------------------------------------

type ModifierSeed = { name: string; price_delta_cents: number; is_default?: boolean };

type GroupSeed = {
  name: string;
  description?: string;
  selection_type: 'single' | 'multiple';
  is_required: boolean;
  min_selections: number;
  max_selections: number | null;
  sort_order: number;
  options: ModifierSeed[];
};

const GROUPS: GroupSeed[] = [
  {
    name: 'Choose Size',
    selection_type: 'single',
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 0,
    options: [
      { name: '10" personal', price_delta_cents: 0, is_default: true },
      { name: '14" medium', price_delta_cents: 400 },
      { name: '18" large', price_delta_cents: 800 },
    ],
  },
  {
    name: 'Crust Type',
    selection_type: 'single',
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 1,
    options: [
      { name: 'Classic', price_delta_cents: 0, is_default: true },
      { name: 'Thin & crispy', price_delta_cents: 0 },
      { name: 'Gluten free', price_delta_cents: 300 },
    ],
  },
  {
    name: 'Extra Toppings',
    description: 'Up to four.',
    selection_type: 'multiple',
    is_required: false,
    min_selections: 0,
    max_selections: 4,
    sort_order: 2,
    options: [
      { name: 'Extra mozzarella', price_delta_cents: 150 },
      { name: 'Pepperoni', price_delta_cents: 200 },
      { name: 'Italian sausage', price_delta_cents: 200 },
      { name: 'Kalamata olives', price_delta_cents: 150 },
      { name: 'Fresh basil', price_delta_cents: 0 },
      { name: 'Hot honey', price_delta_cents: 100 },
    ],
  },
  {
    name: 'Dipping Sauce',
    description: 'Up to two.',
    selection_type: 'multiple',
    is_required: false,
    min_selections: 0,
    max_selections: 2,
    sort_order: 3,
    options: [
      { name: 'Marinara', price_delta_cents: 0, is_default: true },
      { name: 'Garlic butter', price_delta_cents: 0 },
      { name: 'Blue cheese', price_delta_cents: 75 },
      { name: 'Ranch', price_delta_cents: 75 },
    ],
  },
];

const PIZZA_GROUPS = ['Choose Size', 'Crust Type', 'Extra Toppings'];
const APPETIZER_GROUPS = ['Dipping Sauce'];

type ItemSeed = {
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  groups: string[];
  dietary_tags?: string[];
};

const CATEGORIES: { name: string; slug: string; description: string; items: ItemSeed[] }[] = [
  {
    name: 'Pizzas',
    slug: 'pizzas',
    description: 'Hand-stretched, 90 seconds in the wood oven.',
    items: [
      { name: 'Margherita', slug: 'margherita', description: 'San Marzano, fior di latte, basil.', price_cents: 1400, groups: PIZZA_GROUPS, dietary_tags: ['vegetarian'] },
      { name: 'Diavola', slug: 'diavola', description: 'Spicy salami, chilli, mozzarella.', price_cents: 1700, groups: PIZZA_GROUPS, dietary_tags: ['spicy'] },
      { name: 'Supreme', slug: 'supreme', description: 'Sausage, peppers, onion, mushroom, olives.', price_cents: 1900, groups: PIZZA_GROUPS },
      { name: 'Four Cheese', slug: 'four-cheese', description: 'Mozzarella, gorgonzola, fontina, parmesan.', price_cents: 1800, groups: PIZZA_GROUPS, dietary_tags: ['vegetarian'] },
    ],
  },
  {
    name: 'Appetizers',
    slug: 'appetizers',
    description: 'Something while the oven does its work.',
    items: [
      { name: 'Garlic Knots', slug: 'garlic-knots', description: 'Six, brushed with garlic butter.', price_cents: 700, groups: APPETIZER_GROUPS, dietary_tags: ['vegetarian'] },
      { name: 'Mozzarella Sticks', slug: 'mozzarella-sticks', description: 'Hand-breaded, six per order.', price_cents: 900, groups: APPETIZER_GROUPS, dietary_tags: ['vegetarian'] },
      { name: 'Buffalo Wings', slug: 'buffalo-wings', description: 'Eight wings, tossed in buffalo sauce.', price_cents: 1200, groups: APPETIZER_GROUPS, dietary_tags: ['spicy'] },
    ],
  },
  {
    name: 'Beverages & Desserts',
    slug: 'beverages-desserts',
    description: '',
    // No modifier groups: these add straight to the cart without a modal.
    items: [
      { name: 'Italian Soda', slug: 'italian-soda', description: 'Blood orange or lemon.', price_cents: 400, groups: [] },
      { name: 'San Pellegrino', slug: 'san-pellegrino', description: '500ml, sparkling.', price_cents: 350, groups: [] },
      { name: 'Cannoli', slug: 'cannoli', description: 'Ricotta, candied orange, pistachio.', price_cents: 650, groups: [], dietary_tags: ['vegetarian'] },
      { name: 'Tiramisu', slug: 'tiramisu', description: 'Espresso-soaked savoiardi, mascarpone.', price_cents: 750, groups: [], dietary_tags: ['vegetarian'] },
    ],
  },
];

/**
 * Groups and options have no natural unique key beyond their id, so they
 * are matched by name within the tenant. That keeps re-running the script
 * idempotent without inventing slugs the schema does not have.
 */
async function seedMenu(tenantId: string): Promise<void> {
  const groupIds = new Map<string, string>();

  for (const group of GROUPS) {
    const { data: found } = await supabase
      .from('menu_modifier_groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', group.name)
      .maybeSingle();

    let groupId = found?.id;

    if (!groupId) {
      const { data, error } = await supabase
        .from('menu_modifier_groups')
        .insert({
          tenant_id: tenantId,
          name: group.name,
          description: group.description ?? null,
          selection_type: group.selection_type,
          is_required: group.is_required,
          min_selections: group.min_selections,
          max_selections: group.max_selections,
          sort_order: group.sort_order,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`Group "${group.name}": ${error?.message}`);
      groupId = data.id;
    }

    groupIds.set(group.name, groupId);

    for (const [index, option] of group.options.entries()) {
      const { data: existing } = await supabase
        .from('menu_modifiers')
        .select('id')
        .eq('group_id', groupId)
        .eq('name', option.name)
        .maybeSingle();

      if (existing) continue;

      const { error } = await supabase.from('menu_modifiers').insert({
        tenant_id: tenantId,
        group_id: groupId,
        name: option.name,
        price_delta_cents: option.price_delta_cents,
        is_default: option.is_default ?? false,
        sort_order: index,
      });
      if (error) throw new Error(`Option "${option.name}": ${error.message}`);
    }
  }

  console.log(`Seeded ${GROUPS.length} modifier groups`);

  let itemCount = 0;
  let linkCount = 0;

  for (const [categoryIndex, category] of CATEGORIES.entries()) {
    const { data: cat, error: catError } = await supabase
      .from('menu_categories')
      .upsert(
        {
          tenant_id: tenantId,
          name: category.name,
          slug: category.slug,
          description: category.description || null,
          sort_order: categoryIndex,
        },
        { onConflict: 'tenant_id,slug' },
      )
      .select('id')
      .single();

    if (catError || !cat) throw new Error(`Category "${category.name}": ${catError?.message}`);

    for (const [itemIndex, item] of category.items.entries()) {
      const { data: row, error: itemError } = await supabase
        .from('menu_items')
        .upsert(
          {
            tenant_id: tenantId,
            category_id: cat.id,
            name: item.name,
            slug: item.slug,
            description: item.description,
            price_cents: item.price_cents,
            sort_order: itemIndex,
            is_taxable: true,
            dietary_tags: item.dietary_tags ?? [],
          },
          { onConflict: 'tenant_id,slug' },
        )
        .select('id')
        .single();

      if (itemError || !row) throw new Error(`Item "${item.name}": ${itemError?.message}`);
      itemCount += 1;

      for (const [groupIndex, groupName] of item.groups.entries()) {
        const groupId = groupIds.get(groupName);
        if (!groupId) throw new Error(`Unknown group "${groupName}" on ${item.name}`);

        const { error: linkError } = await supabase
          .from('menu_item_modifier_groups')
          .upsert(
            { tenant_id: tenantId, item_id: row.id, group_id: groupId, sort_order: groupIndex },
            { onConflict: 'item_id,group_id' },
          );
        if (linkError) throw new Error(`Linking ${item.name}/${groupName}: ${linkError.message}`);
        linkCount += 1;
      }
    }
  }

  console.log(`Seeded ${CATEGORIES.length} categories, ${itemCount} items, ${linkCount} option links`);
}

async function main(): Promise<void> {
  // ---- tenant ---------------------------------------------------------
  const { data: existing } = await supabase
    .from('tenants')
    .select('id, slug, status')
    .eq('slug', slug)
    .maybeSingle();

  let tenantId: string;

  if (existing) {
    tenantId = existing.id;
    console.log(`Tenant "${slug}" already exists (${tenantId})`);
  } else {
    const { data, error } = await supabase
      .from('tenants')
      .insert({
        slug,
        name,
        status: 'active',
        subscription_status: 'active',
        timezone: 'America/New_York',
        currency: 'USD',
        support_email: `hello@${slug}.example`,
        onboarded_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`Could not create tenant: ${error?.message}`);
    tenantId = data.id;
    console.log(`Created tenant "${slug}" (${tenantId})`);
  }

  // ---- settings -------------------------------------------------------
  // The tenants insert trigger already bootstrapped a row; this applies the
  // platform's onboarding defaults, with the $1.00 fee ON.
  const { error: settingsError } = await supabase
    .from('tenant_settings')
    .update({
      tagline: 'A demonstration storefront',
      description: 'Seeded to validate routing and checkout end to end.',
      brand_primary_color: '#1f2937',
      brand_accent_color: '#dc2626',
      tech_fee_enabled: true,
      tech_fee_cents: 100,
      estimated_prep_time_mins: 20,
      accepts_delivery: true,
      accepts_pickup: true,
      delivery_fee_cents: 499,
      delivery_minimum_cents: 1500,
      tax_rate_bps: 875,
      default_tip_bps: 1800,
      address_line1: '218 Fayetteville St',
      city: 'Raleigh',
      region: 'NC',
      postal_code: '27601',
      country: 'US',
    })
    .eq('tenant_id', tenantId);

  if (settingsError) throw new Error(`Could not configure settings: ${settingsError.message}`);
  console.log('Applied onboarding defaults (tech fee on, $1.00)');

  // ---- menu -----------------------------------------------------------
  // A storefront with no menu renders an empty state -- technically a 200,
  // but nothing anyone can order from, so it is not a real check.
  //
  // Modifier groups are attached deliberately to exercise all three paths
  // the storefront has to handle: a required single-select (Size, Crust),
  // an optional capped multi-select (Toppings, Dipping Sauce), and items
  // with no options at all, which skip the modal and add straight to cart.
  await seedMenu(tenantId);

  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
  console.log(`\nStorefront: https://${slug}.${root}`);
}

main().catch((error: unknown) => {
  console.error(`\nProvisioning failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
