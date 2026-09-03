import { NextResponse, type NextRequest } from 'next/server';
import { createClientForRequest } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/guard';

/**
 * Internal-only endpoint to create a synthetic test tenant for preview-upload
 * verification. Super Admin access required. Idempotent on slug.
 *
 * Returns only the safe public preview URL, never secrets or claim tokens.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEST_TENANT = {
  name: 'Vardr Upload Test Kitchen',
  slug: 'vardr-upload-test',
};

type MenuCategory = {
  name: string;
  slug: string;
  description: string;
  items: Array<{
    name: string;
    slug: string;
    description: string;
    price_cents: number;
  }>;
};

const SAMPLE_MENU: MenuCategory[] = [
  {
    name: 'Pizzas',
    slug: 'pizzas',
    description: 'Hand-tossed with premium ingredients.',
    items: [
      { name: 'Margherita', slug: 'margherita', description: 'Mozzarella and fresh basil.', price_cents: 1400 },
      { name: 'Pepperoni', slug: 'pepperoni', description: 'Classic pepperoni pizza.', price_cents: 1600 },
    ],
  },
  {
    name: 'Appetizers',
    slug: 'appetizers',
    description: 'Perfect starters.',
    items: [
      { name: 'Garlic Knots', slug: 'garlic-knots', description: 'Six brushed with garlic butter.', price_cents: 700 },
      { name: 'Mozzarella Sticks', slug: 'mozzarella-sticks', description: 'Six hand-breaded sticks.', price_cents: 900 },
    ],
  },
  {
    name: 'Beverages & Desserts',
    slug: 'beverages-desserts',
    description: 'Drinks and sweets.',
    items: [
      { name: 'Italian Soda', slug: 'italian-soda', description: 'Blood orange or lemon.', price_cents: 400 },
      { name: 'Tiramisu', slug: 'tiramisu', description: 'Classic tiramisu dessert.', price_cents: 750 },
    ],
  },
];

async function seedMenu(supabase: any, tenantId: string): Promise<void> {
  for (const [categoryIndex, category] of SAMPLE_MENU.entries()) {
    const { data: cat, error: catError } = await supabase
      .from('menu_categories')
      .upsert(
        {
          tenant_id: tenantId,
          name: category.name,
          slug: category.slug,
          description: category.description,
          sort_order: categoryIndex,
        },
        { onConflict: 'tenant_id,slug' },
      )
      .select('id')
      .single();

    if (catError || !cat) {
      throw new Error(`Category "${category.name}": ${catError?.message}`);
    }

    for (const [itemIndex, item] of category.items.entries()) {
      const { error: itemError } = await supabase
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
            source: 'seed',
          },
          { onConflict: 'tenant_id,slug' },
        );

      if (itemError) {
        throw new Error(`Item "${item.name}": ${itemError.message}`);
      }
    }
  }
}

async function seedModifiers(supabase: any, tenantId: string): Promise<void> {
  // Seed modifier groups for pizza sizes, toppings, etc.
  const groups = [
    {
      name: 'Pizza Size',
      slug: 'pizza-size',
      selection_type: 'single' as const,
      is_required: true,
      min_selections: 1,
      max_selections: 1,
      sort_order: 0,
      options: [
        { name: '10" Personal', price_delta_cents: 0, is_default: true },
        { name: '14" Medium', price_delta_cents: 400 },
        { name: '18" Large', price_delta_cents: 800 },
      ],
    },
    {
      name: 'Toppings',
      slug: 'toppings',
      selection_type: 'multiple' as const,
      is_required: false,
      min_selections: 0,
      max_selections: 4,
      sort_order: 1,
      options: [
        { name: 'Extra Cheese', price_delta_cents: 150, is_default: false },
        { name: 'Pepperoni', price_delta_cents: 200, is_default: false },
        { name: 'Mushrooms', price_delta_cents: 100, is_default: false },
        { name: 'Olives', price_delta_cents: 100, is_default: false },
      ],
    },
  ];

  for (const group of groups) {
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
          description: null,
          selection_type: group.selection_type,
          is_required: group.is_required,
          min_selections: group.min_selections,
          max_selections: group.max_selections,
          sort_order: group.sort_order,
          is_active: true,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`Group "${group.name}": ${error?.message}`);
      groupId = data.id;
    }

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
        is_available: true,
        sort_order: index,
      });
      if (error) throw new Error(`Option "${option.name}": ${error.message}`);
    }
  }
}

async function linkPizzaModifiers(supabase: any, tenantId: string): Promise<void> {
  // Link Pizza Size and Toppings groups to pizza items (Margherita, Pepperoni)
  const { data: pizzaItems } = await supabase
    .from('menu_items')
    .select('id, slug')
    .eq('tenant_id', tenantId)
    .in('slug', ['margherita', 'pepperoni']);

  if (!pizzaItems?.length) return;

  const { data: groups } = await supabase
    .from('menu_modifier_groups')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('name', ['Pizza Size', 'Toppings']);

  if (!groups?.length) return;

  const groupMap = new Map(groups.map((g: any) => [g.name, g.id]));

  for (const item of pizzaItems) {
    for (const [groupName, sort_order] of [
      ['Pizza Size', 0],
      ['Toppings', 1],
    ] as const) {
      const groupId = groupMap.get(groupName);
      if (!groupId) continue;

      const { data: existing } = await supabase
        .from('menu_item_modifier_groups')
        .select('id')
        .eq('item_id', item.id)
        .eq('group_id', groupId)
        .maybeSingle();

      if (existing) continue;

      await supabase.from('menu_item_modifier_groups').insert({
        tenant_id: tenantId,
        item_id: item.id,
        group_id: groupId,
        sort_order,
      });
    }
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }

  const supabase = await createClientForRequest();

  try {
    // Step 1: Check if the test tenant already exists
    const { data: existing } = await supabase
      .from('tenants')
      .select('id, status')
      .eq('slug', TEST_TENANT.slug)
      .maybeSingle();

    let tenantId: string;

    if (existing) {
      tenantId = existing.id;
      // If it was already claimed, we can't use it for preview testing
      if (existing.status !== 'pending_claim') {
        return NextResponse.json(
          { error: `Test tenant "${TEST_TENANT.slug}" has already been claimed. It cannot be reused.` },
          { status: 409 },
        );
      }
    } else {
      // Step 2: Create the test tenant with pending_claim status
      const { data: tenant, error: createError } = await supabase
        .from('tenants')
        .insert({
          name: TEST_TENANT.name,
          slug: TEST_TENANT.slug,
          status: 'pending_claim',
          subscription_status: 'trialing',
          timezone: 'America/New_York',
          currency: 'USD',
          support_email: `test@${TEST_TENANT.slug}.example`,
          onboarded_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError || !tenant) {
        return NextResponse.json(
          { error: createError?.message ?? 'Failed to create test tenant' },
          { status: 500 },
        );
      }

      tenantId = tenant.id;

      // Step 3: Apply settings
      const { error: settingsError } = await supabase
        .from('tenant_settings')
        .update({
          tagline: 'Test Kitchen - Preview and Upload Testing',
          description: 'Internal testing only. Sample menu for preview validation.',
          tech_fee_enabled: false,
          estimated_prep_time_mins: 20,
          accepts_delivery: false,
          accepts_pickup: true,
        })
        .eq('tenant_id', tenantId);

      if (settingsError) {
        // Rollback the tenant
        await supabase.from('tenants').delete().eq('id', tenantId);
        return NextResponse.json(
          { error: `Failed to apply settings: ${settingsError.message}` },
          { status: 500 },
        );
      }
    }

    // Step 4: Seed menu (idempotent via upsert)
    await seedMenu(supabase, tenantId);

    // Step 5: Seed modifier groups for demo (pizza sizes, toppings, etc.)
    await seedModifiers(supabase, tenantId);

    // Step 6: Link modifiers to pizza items
    await linkPizzaModifiers(supabase, tenantId);

    // Step 5: Get the root domain for the preview URL
    const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
    const previewUrl = `https://${TEST_TENANT.slug}.${root}`;

    return NextResponse.json(
      {
        success: true,
        message: 'Test tenant provisioned successfully',
        previewUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
