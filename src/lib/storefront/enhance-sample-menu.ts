/**
 * Enhance a sample/demo menu with realistic customization options.
 *
 * This creates modifier groups (sizes, sauces, toppings, etc.) and links them
 * to sample menu items with appropriate price deltas. It is idempotent and
 * safe to run multiple times on the same tenant.
 *
 * Used to demonstrate the full ordering experience on demo storefronts,
 * without making items orderable.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export interface EnhanceMenuOptions {
  tenantId: string;
  db: SupabaseClient<Database>;
}

interface ModifierGroupDef {
  name: string;
  description?: string;
  selectionType: 'single' | 'multiple';
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
  modifiers: Array<{
    name: string;
    priceDeltaCents: number;
    isDefault: boolean;
    sortOrder: number;
  }>;
}

const MODIFIER_GROUPS: ModifierGroupDef[] = [
  // Size options - single choice, required
  {
    name: 'Size',
    description: 'Choose your size',
    selectionType: 'single',
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    modifiers: [
      { name: 'Small', priceDeltaCents: 0, isDefault: true, sortOrder: 0 },
      { name: 'Medium', priceDeltaCents: 150, isDefault: false, sortOrder: 1 },
      { name: 'Large', priceDeltaCents: 300, isDefault: false, sortOrder: 2 },
    ],
  },

  // Sauce options - single choice, optional
  {
    name: 'Sauce',
    description: 'Pick your sauce',
    selectionType: 'single',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    sortOrder: 1,
    modifiers: [
      { name: 'Light', priceDeltaCents: 0, isDefault: false, sortOrder: 0 },
      { name: 'Regular', priceDeltaCents: 0, isDefault: true, sortOrder: 1 },
      { name: 'Extra', priceDeltaCents: 75, isDefault: false, sortOrder: 2 },
      { name: 'Hot Sauce', priceDeltaCents: 50, isDefault: false, sortOrder: 3 },
    ],
  },

  // Toppings - multiple choice, optional
  {
    name: 'Toppings',
    description: 'Add toppings (choose up to 4)',
    selectionType: 'multiple',
    isRequired: false,
    minSelections: 0,
    maxSelections: 4,
    sortOrder: 2,
    modifiers: [
      { name: 'Extra Cheese', priceDeltaCents: 125, isDefault: false, sortOrder: 0 },
      { name: 'Bacon', priceDeltaCents: 175, isDefault: false, sortOrder: 1 },
      { name: 'Mushrooms', priceDeltaCents: 75, isDefault: false, sortOrder: 2 },
      { name: 'Onions', priceDeltaCents: 50, isDefault: false, sortOrder: 3 },
      { name: 'Peppers', priceDeltaCents: 75, isDefault: false, sortOrder: 4 },
      { name: 'Olives', priceDeltaCents: 100, isDefault: false, sortOrder: 5 },
    ],
  },

  // Add-ons - multiple choice, optional
  {
    name: 'Add-ons',
    description: 'Add extras to your order',
    selectionType: 'multiple',
    isRequired: false,
    minSelections: 0,
    maxSelections: 3,
    sortOrder: 3,
    modifiers: [
      { name: 'Garlic Bread', priceDeltaCents: 200, isDefault: false, sortOrder: 0 },
      { name: 'Side Salad', priceDeltaCents: 150, isDefault: false, sortOrder: 1 },
      { name: 'Extra Sauce', priceDeltaCents: 50, isDefault: false, sortOrder: 2 },
    ],
  },

  // Protein choice - single choice, optional
  {
    name: 'Protein',
    description: 'Choose your protein',
    selectionType: 'single',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    sortOrder: 4,
    modifiers: [
      { name: 'Chicken', priceDeltaCents: 200, isDefault: false, sortOrder: 0 },
      { name: 'Beef', priceDeltaCents: 250, isDefault: false, sortOrder: 1 },
      { name: 'Shrimp', priceDeltaCents: 300, isDefault: false, sortOrder: 2 },
      { name: 'Vegetarian', priceDeltaCents: 0, isDefault: false, sortOrder: 3 },
    ],
  },
];

/**
 * Map items to their modifier groups.
 * The key is the item slug, the value is an array of group names in sort order.
 */
const ITEM_MODIFIER_MAPPING: Record<string, string[]> = {
  // Any sandwich-like items get size, sauce, toppings
  '.*sandwich.*': ['Size', 'Sauce', 'Toppings'],
  '.*burger.*': ['Size', 'Toppings', 'Add-ons'],
  '.*wrap.*': ['Size', 'Sauce', 'Toppings'],

  // Main courses often have protein choice
  '.*bowl.*': ['Size', 'Protein', 'Sauce', 'Toppings'],
  '.*plate.*': ['Size', 'Protein', 'Sauce'],

  // Generic items get standard modifications
  '.*entree.*': ['Size', 'Protein', 'Sauce'],

  // By default, items without a specific match still get sizes
  '.*': ['Size', 'Sauce', 'Toppings'],
};

export async function enhanceSampleMenu(options: EnhanceMenuOptions): Promise<{
  groupsCreated: number;
  modifiersCreated: number;
  itemsLinked: number;
}> {
  const { tenantId, db } = options;

  let groupsCreated = 0;
  let modifiersCreated = 0;
  let itemsLinked = 0;

  // Step 1: Create or fetch modifier groups
  const groupMap = new Map<string, string>(); // name -> id

  for (const groupDef of MODIFIER_GROUPS) {
    // Check if group already exists
    const { data: existing } = await db
      .from('menu_modifier_groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', groupDef.name)
      .maybeSingle();

    let groupId: string;

    if (existing) {
      groupId = existing.id;
    } else {
      const { data: created, error } = await db
        .from('menu_modifier_groups')
        .insert({
          tenant_id: tenantId,
          name: groupDef.name,
          description: groupDef.description,
          selection_type: groupDef.selectionType,
          is_required: groupDef.isRequired,
          min_selections: groupDef.minSelections,
          max_selections: groupDef.maxSelections,
          sort_order: groupDef.sortOrder,
          is_active: true,
        } as never)
        .select('id')
        .single();

      if (error || !created) {
        throw new Error(`Failed to create modifier group "${groupDef.name}": ${error?.message}`);
      }

      groupId = created.id;
      groupsCreated += 1;
    }

    groupMap.set(groupDef.name, groupId);

    // Step 2: Create modifiers within the group
    for (const modifier of groupDef.modifiers) {
      const { data: existing } = await db
        .from('menu_modifiers')
        .select('id')
        .eq('group_id', groupId)
        .eq('name', modifier.name)
        .maybeSingle();

      if (existing) continue;

      const { error } = await db
        .from('menu_modifiers')
        .insert({
          tenant_id: tenantId,
          group_id: groupId,
          name: modifier.name,
          price_delta_cents: modifier.priceDeltaCents,
          is_default: modifier.isDefault,
          is_available: true,
          sort_order: modifier.sortOrder,
        } as never);

      if (error) {
        throw new Error(`Failed to create modifier "${modifier.name}": ${error.message}`);
      }

      modifiersCreated += 1;
    }
  }

  // Step 3: Link items to modifier groups
  const { data: items } = await db
    .from('menu_items')
    .select('id, slug')
    .eq('tenant_id', tenantId)
    .order('slug');

  if (items && items.length > 0) {
    for (const item of items) {
      // Find matching modifier groups for this item
      let matchedGroups: string[] = [];

      for (const [pattern, groups] of Object.entries(ITEM_MODIFIER_MAPPING)) {
        const regex = new RegExp(`^${pattern}$`, 'i');
        if (regex.test(item.slug)) {
          matchedGroups = groups;
          break;
        }
      }

      // Link each group to the item
      for (const [sortOrder, groupName] of matchedGroups.entries()) {
        const groupId = groupMap.get(groupName);
        if (!groupId) continue;

        const { data: existing } = await db
          .from('menu_item_modifier_groups')
          .select('id')
          .eq('item_id', item.id)
          .eq('group_id', groupId)
          .maybeSingle();

        if (existing) continue;

        const { error } = await db
          .from('menu_item_modifier_groups')
          .insert({
            tenant_id: tenantId,
            item_id: item.id,
            group_id: groupId,
            sort_order: sortOrder,
          } as never);

        if (error) {
          throw new Error(
            `Failed to link modifier group "${groupName}" to item "${item.slug}": ${error.message}`,
          );
        }

        itemsLinked += 1;
      }
    }
  }

  return { groupsCreated, modifiersCreated, itemsLinked };
}
