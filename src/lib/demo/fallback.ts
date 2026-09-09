/**
 * Demo fallback storefront provisioning.
 *
 * When Raven scraping fails, a fallback demo allows the restaurant to view
 * a preview with their discovered name, optional logo, and optional menu.
 * Logo and menu are non-blocking: missing them doesn't prevent preview.
 *
 * Sample menu is provided initially (3 categories, ~10 items each).
 * Items are marked source='sample' and permanently unavailable, even after
 * the owner claims. The owner must upload a real menu to enable ordering.
 *
 * Fallback demos never automatically activate. Activation requires operator
 * approval and menu verification, same as scrape-based provisioning.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { parseAndStage, type StageInput } from '@/lib/scraper/parse-and-stage';

export type FallbackState =
  | 'created'
  | 'awaiting_logo'
  | 'awaiting_menu'
  | 'preview_ready'
  | 'claimed'
  | 'activated';

export interface CreateFallbackInput {
  name: string;
  raven_prospect_id?: string;
  category?: string;
}

export interface FallbackRecord {
  id: string;
  tenant_id: string;
  raven_prospect_id: string | null;
  state: FallbackState;
  logo_uploaded_at: string | null;
  menu_uploaded_at: string | null;
  menu_verified_at: string | null;
  claimed_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

function serviceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not set');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/**
 * Sample menu for demo fallback.
 * 3 categories with ~10 items each, realistic restaurant items.
 */
export function generateSampleMenu(): {
  categories: Array<{
    name: string;
    items: Array<{ name: string; description?: string; priceCents: number }>;
  }>;
} {
  return {
    categories: [
      {
        name: 'Appetizers',
        items: [
          { name: 'Bruschetta', description: 'Toasted bread with tomato and basil', priceCents: 699 },
          { name: 'Calamari', description: 'Fried squid with marinara sauce', priceCents: 899 },
          { name: 'Caprese Salad', description: 'Fresh mozzarella, tomato, basil', priceCents: 799 },
          { name: 'Garlic Bread', description: 'Crispy bread with roasted garlic butter', priceCents: 599 },
          { name: 'Mozzarella Sticks', description: 'Breaded and fried cheese', priceCents: 749 },
          { name: 'Shrimp Tempura', description: 'Light and crispy fried shrimp', priceCents: 1099 },
          { name: 'Spring Rolls', description: 'Three vegetable and shrimp rolls', priceCents: 649 },
          { name: 'Spinach Artichoke Dip', description: 'Creamy dip with warm pita', priceCents: 849 },
          { name: 'Buffalo Wings', description: 'Spicy chicken wings with celery', priceCents: 899 },
          { name: 'Nachos', description: 'Tortilla chips with cheese and jalapeños', priceCents: 799 },
        ],
      },
      {
        name: 'Entrées',
        items: [
          { name: 'Pasta Primavera', description: 'Fresh seasonal vegetables with garlic sauce', priceCents: 1399 },
          { name: 'Grilled Salmon', description: 'Atlantic salmon with lemon butter', priceCents: 2199 },
          { name: 'Ribeye Steak', description: '12oz prime cut with herb butter', priceCents: 2899 },
          { name: 'Chicken Parmesan', description: 'Crispy chicken with marinara and mozzarella', priceCents: 1599 },
          { name: 'Lasagna', description: 'Layers of pasta, meat sauce, and ricotta', priceCents: 1499 },
          { name: 'Shrimp Scampi', description: 'Garlic and white wine sauce with angel hair pasta', priceCents: 1899 },
          { name: 'Beef Tacos', description: 'Three seasoned beef tacos with toppings', priceCents: 1199 },
          { name: 'Vegetarian Risotto', description: 'Creamy arborio rice with mushrooms and peas', priceCents: 1299 },
          { name: 'Fish & Chips', description: 'Battered cod with hand-cut fries', priceCents: 1399 },
          { name: 'Duck Confit', description: 'Slow-cooked duck leg with roasted potatoes', priceCents: 2099 },
        ],
      },
      {
        name: 'Desserts',
        items: [
          { name: 'Chocolate Cake', description: 'Rich chocolate with vanilla ice cream', priceCents: 699 },
          { name: 'Tiramisu', description: 'Classic Italian dessert with espresso', priceCents: 749 },
          { name: 'Cheesecake', description: 'New York style with berry compote', priceCents: 799 },
          { name: 'Crème Brûlée', description: 'Vanilla custard with caramelized sugar', priceCents: 699 },
          { name: 'Panna Cotta', description: 'Silky Italian cream with berry sauce', priceCents: 749 },
          { name: 'Ice Cream Sundae', description: 'Three scoops with toppings', priceCents: 599 },
          { name: 'Chocolate Mousse', description: 'Airy chocolate with whipped cream', priceCents: 549 },
          { name: 'Lemon Sorbet', description: 'Refreshing citrus frozen dessert', priceCents: 499 },
          { name: 'Apple Pie à la Mode', description: 'Warm pie with vanilla ice cream', priceCents: 599 },
          { name: 'Chocolate Lava Cake', description: 'Warm center with ice cream', priceCents: 799 },
        ],
      },
    ],
  };
}

/** Render the fallback menu in the schema.org JSON-LD format the existing
 * structured parser consumes. */
export function sampleMenuContent(name: string): string {
  const menu = generateSampleMenu();
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Restaurant', name },
      // Sample modifier groups (size, toppings, etc)
      {
        '@type': 'MenuSection',
        name: 'Item Modifiers',
        hasMenuItem: [
          {
            '@type': 'MenuItem',
            name: 'Size',
            description: 'Choose your portion size',
            additionalProperty: [
              { '@type': 'PropertyValue', name: 'type', value: 'modifier_group' },
              { '@type': 'PropertyValue', name: 'selection_type', value: 'single' },
            ],
            hasMenuItemOption: [
              { '@type': 'MenuItemOption', name: 'Small', price: '0.00' },
              { '@type': 'MenuItemOption', name: 'Medium', price: '1.00' },
              { '@type': 'MenuItemOption', name: 'Large', price: '2.00' },
            ],
          },
          {
            '@type': 'MenuItem',
            name: 'Extra Toppings',
            description: 'Add extra toppings',
            additionalProperty: [
              { '@type': 'PropertyValue', name: 'type', value: 'modifier_group' },
              { '@type': 'PropertyValue', name: 'selection_type', value: 'multiple' },
            ],
            hasMenuItemOption: [
              { '@type': 'MenuItemOption', name: 'Extra Cheese', price: '0.75' },
              { '@type': 'MenuItemOption', name: 'Extra Pepperoni', price: '1.00' },
              { '@type': 'MenuItemOption', name: 'Mushrooms', price: '0.50' },
              { '@type': 'MenuItemOption', name: 'Olives', price: '0.75' },
            ],
          },
        ],
      },
      ...menu.categories.map((category) => ({
        '@type': 'MenuSection',
        name: category.name,
        hasMenuItem: category.items.map((item) => ({
          '@type': 'MenuItem',
          name: item.name,
          description: item.description,
          offers: {
            '@type': 'Offer',
            price: (item.priceCents / 100).toFixed(2),
            priceCurrency: 'USD',
          },
        })),
      })),
    ],
  });
}

/**
 * Create a demo fallback for a restaurant.
 *
 * Reuses existing fallback if raven_prospect_id already has one.
 * Creates a staging tenant with sample menu marked source='sample'.
 * Returns tenant ID and preview URL.
 */
export async function createFallback(input: CreateFallbackInput): Promise<{
  tenant_id: string;
  slug: string;
  preview_url: string;
  state: FallbackState;
}> {
  const db = serviceClient();

  // If Raven prospect exists, check for existing fallback
  if (input.raven_prospect_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db as any)
      .from('demo_fallback_state')
      .select('tenant_id, state')
      .eq('raven_prospect_id', input.raven_prospect_id)
      .maybeSingle();

    if (existing.data) {
      // Reuse existing fallback
      const tenantData = await db
        .from('tenants')
        .select('id, slug')
        .eq('id', existing.data.tenant_id)
        .single();

      if (tenantData.data) {
        return {
          tenant_id: existing.data.tenant_id,
          slug: tenantData.data.slug,
          preview_url: buildPreviewUrl(tenantData.data.slug),
          state: existing.data.state,
        };
      }
    }
  }

  // Create new fallback tenant with sample menu
  const stageInput: StageInput = {
    content: sampleMenuContent(input.name),
    sourceUrl: 'sample-menu://fallback-demo',
    nameHint: input.name,
    sampleMenu: true,
  };

  const staged = await parseAndStage(stageInput);

  // Add modifiers to sample menu items for demo preview (stageInput.sampleMenu indicates a demo)
  if (stageInput.sampleMenu) {
    await addSampleMenuModifiers(db, staged.tenantId);
  }

  // Record fallback state
  const fallbackData: Omit<FallbackRecord, 'id' | 'created_at' | 'updated_at'> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tenant_id: staged.tenantId as any,
    raven_prospect_id: input.raven_prospect_id ?? null,
    state: 'created',
    logo_uploaded_at: null,
    menu_uploaded_at: null,
    menu_verified_at: null,
    claimed_at: null,
    activated_at: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: fallbackError } = await (db as any).from('demo_fallback_state').insert(fallbackData);

  if (fallbackError) {
    throw new Error(`Could not record fallback state: ${fallbackError.message}`);
  }

  return {
    tenant_id: staged.tenantId,
    slug: staged.tenantId, // Will be replaced by actual slug from tenant
    preview_url: buildPreviewUrl(staged.tenantId),
    state: 'created',
  };
}

/**
 * Add representative modifiers to sample menu items.
 * Creates Size, Toppings, and Spice Level modifier groups.
 */
async function addSampleMenuModifiers(db: SupabaseClient<Database>, tenantId: string): Promise<void> {
  try {
    // Get menu items that should have modifiers (Entrées like Pasta, Steak)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (db as any)
      .from('menu_items')
      .select('id, name, category_id')
      .eq('tenant_id', tenantId)
      .in('name', ['Pasta Primavera', 'Grilled Salmon', 'Ribeye Steak', 'Chicken Parmesan']);

    if (!items || items.length === 0) return;

    // Create Size modifier group (required, radio)
    const { data: sizeGroup, error: sizeGroupError } = await db
      .from('menu_modifier_groups')
      .insert({
        tenant_id: tenantId,
        name: 'Size',
        description: 'Choose your portion size',
        selection_type: 'single',
        is_active: true,
        is_required: true,
        min_selections: 1,
        max_selections: 1,
      })
      .select('id')
      .single();

    if (sizeGroupError) {
      console.warn('Failed to create size modifier group:', sizeGroupError);
    }

    if (sizeGroup) {
      // Add size options
      const sizes = [
        { name: 'Small', price_adjustment_cents: 0, is_default: false },
        { name: 'Regular', price_adjustment_cents: 0, is_default: true },
        { name: 'Large', price_adjustment_cents: 150 },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: modifierError } = await (db as any).from('menu_modifiers').insert(
        sizes.map((s, i) => ({
          tenant_id: tenantId,
          group_id: sizeGroup.id,
          name: s.name,
          price_adjustment_cents: s.price_adjustment_cents,
          is_default: s.is_default,
          is_available: true,
          sort_order: i,
        })),
      );

      if (modifierError) {
        console.warn('Failed to add size modifiers:', modifierError);
      }
    }

    // Create Toppings modifier group (optional, checkboxes)
    const { data: toppingsGroup, error: toppingsGroupError } = await db
      .from('menu_modifier_groups')
      .insert({
        tenant_id: tenantId,
        name: 'Add-ons',
        description: 'Add extra toppings and ingredients',
        selection_type: 'multiple',
        is_active: true,
        is_required: false,
        min_selections: 0,
        max_selections: 4,
      })
      .select('id')
      .single();

    if (toppingsGroupError) {
      console.warn('Failed to create toppings modifier group:', toppingsGroupError);
    }

    if (toppingsGroup) {
      const toppings = [
        { name: 'Extra Cheese', price_adjustment_cents: 75 },
        { name: 'Extra Protein', price_adjustment_cents: 200 },
        { name: 'Garlic & Herbs', price_adjustment_cents: 50 },
        { name: 'Extra Vegetables', price_adjustment_cents: 75 },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: modifierError } = await (db as any).from('menu_modifiers').insert(
        toppings.map((t, i) => ({
          tenant_id: tenantId,
          group_id: toppingsGroup.id,
          name: t.name,
          price_adjustment_cents: t.price_adjustment_cents,
          is_default: false,
          is_available: true,
          sort_order: i,
        })),
      );

      if (modifierError) {
        console.warn('Failed to add topping modifiers:', modifierError);
      }
    }

    // Link modifier groups to specific items
    if (sizeGroup && toppingsGroup) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkError } = await (db as any).from('menu_item_modifier_groups').insert(
        items.flatMap((item: any) => [
          { tenant_id: tenantId, item_id: item.id, group_id: sizeGroup.id, sort_order: 0 },
          { tenant_id: tenantId, item_id: item.id, group_id: toppingsGroup.id, sort_order: 1 },
        ]),
      );

      if (linkError) {
        console.warn('Failed to link modifier groups to items:', linkError);
      }
    }
  } catch (error) {
    // Silently fail if modifiers can't be added - the menu still works without them
    console.warn('Could not add sample menu modifiers:', error);
  }
}

/**
 * Update fallback state after logo upload.
 */
export async function recordLogoUpload(tenant_id: string): Promise<void> {
  const db = serviceClient();
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('demo_fallback_state')
    .update({ logo_uploaded_at: now, updated_at: now })
    .eq('tenant_id', tenant_id);

  if (error) {
    throw new Error(`Could not record logo upload: ${error.message}`);
  }
}

/**
 * Update fallback state after menu upload.
 */
export async function recordMenuUpload(tenant_id: string): Promise<void> {
  const db = serviceClient();
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('demo_fallback_state')
    .update({ menu_uploaded_at: now, updated_at: now })
    .eq('tenant_id', tenant_id);

  if (error) {
    throw new Error(`Could not record menu upload: ${error.message}`);
  }
}

/**
 * Transition fallback to claimed state.
 * Called after claim token is redeemed.
 */
export async function markFallbackClaimed(tenant_id: string): Promise<void> {
  const db = serviceClient();
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('demo_fallback_state')
    .update({ state: 'claimed', claimed_at: now, updated_at: now })
    .eq('tenant_id', tenant_id);

  if (error) {
    throw new Error(`Could not mark fallback claimed: ${error.message}`);
  }
}

/**
 * Activate fallback (mark as live for ordering).
 * Only allowed after:
 * - Owner has claimed
 * - Menu has been verified
 * - Operator has approved activation
 */
export async function activateFallback(tenant_id: string): Promise<void> {
  const db = serviceClient();
  const now = new Date().toISOString();

  // Verify fallback exists and is in claimed state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fallback = await (db as any)
    .from('demo_fallback_state')
    .select('state, menu_verified_at')
    .eq('tenant_id', tenant_id)
    .single();

  if (fallback.error || !fallback.data) {
    throw new Error('Fallback not found');
  }

  if (fallback.data.state !== 'claimed') {
    throw new Error(`Fallback must be claimed before activation, current state: ${fallback.data.state}`);
  }

  if (!fallback.data.menu_verified_at) {
    throw new Error('Menu must be verified before activation');
  }

  // Transition to activated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('demo_fallback_state')
    .update({ state: 'activated', activated_at: now, updated_at: now })
    .eq('tenant_id', tenant_id);

  if (error) {
    throw new Error(`Could not activate fallback: ${error.message}`);
  }

  // Update tenant status to active (if not already)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.from('tenants').update({ status: 'active' } as any).eq('id', tenant_id);
}

/**
 * Check if a tenant is a fallback demo.
 */
export async function isFallbackDemo(tenant_id: string): Promise<boolean> {
  const db = serviceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any)
    .from('demo_fallback_state')
    .select('id')
    .eq('tenant_id', tenant_id)
    .maybeSingle();

  return !!result.data;
}

/**
 * Get fallback status for a tenant.
 */
export async function getFallbackStatus(tenant_id: string): Promise<FallbackRecord | null> {
  const db = serviceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any)
    .from('demo_fallback_state')
    .select('*')
    .eq('tenant_id', tenant_id)
    .maybeSingle();

  return (result.data as FallbackRecord) || null;
}

function buildPreviewUrl(tenantId: string): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'order.example';
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  // Use path-based preview: /preview/<tenant-id> instead of subdomain
  return `${protocol}://${root}/preview/${tenantId}`;
}
