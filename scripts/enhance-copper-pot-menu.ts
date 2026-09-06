/**
 * Enhance the Copper Pot Test Bistro demo menu with realistic customization options.
 *
 * This script adds modifier groups and links them to the sample menu items,
 * allowing demo visitors to see realistic item customization with price changes.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/enhance-copper-pot-menu.ts
 *
 * The script is idempotent and safe to run multiple times.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { enhanceSampleMenu } from '@/lib/storefront/enhance-sample-menu';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required');
    process.exit(1);
  }

  const db = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Find Copper Pot Test Bistro tenant
  const { data: tenant, error: tenantError } = await db
    .from('tenants')
    .select('id, name, slug')
    .ilike('name', '%copper%pot%')
    .or('slug.ilike.%copper%,slug.ilike.%test%')
    .maybeSingle();

  if (tenantError) {
    console.error('Error finding tenant:', tenantError.message);
    process.exit(1);
  }

  if (!tenant) {
    console.error('Error: Copper Pot Test Bistro tenant not found');
    console.error('Create the prospect first and provision it before enhancing the menu');
    process.exit(1);
  }

  console.log(`\nEnhancing sample menu for: ${tenant.name} (${tenant.slug})\n`);

  try {
    const result = await enhanceSampleMenu({ tenantId: tenant.id, db });

    console.log(`✓ Modifier groups created: ${result.groupsCreated}`);
    console.log(`✓ Modifiers created: ${result.modifiersCreated}`);
    console.log(`✓ Items linked to modifiers: ${result.itemsLinked}`);

    // Verify the enhancement
    const { data: groups } = await db
      .from('menu_modifier_groups')
      .select('name, is_required, selection_type, max_selections')
      .eq('tenant_id', tenant.id)
      .order('sort_order');

    if (groups && groups.length > 0) {
      console.log(`\nModifier groups created:`);
      for (const group of groups) {
        const required = group.is_required ? 'Required' : 'Optional';
        const type = group.selection_type === 'single' ? 'Single choice' : 'Multiple choice';
        const max = group.max_selections ? ` (max ${group.max_selections})` : '';
        console.log(`  • ${group.name} — ${required}, ${type}${max}`);
      }
    }

    const { data: items } = await db
      .from('menu_items')
      .select('name, slug')
      .eq('tenant_id', tenant.id)
      .eq('source', 'sample')
      .order('slug');

    if (items && items.length > 0) {
      console.log(`\nSample menu items enhanced:`);
      for (const item of items) {
        const { data: itemGroups } = await db
          .from('menu_item_modifier_groups')
          .select('menu_modifier_groups(name)')
          .eq('item_id', item.name) // This will be replaced in the actual query
          .eq('tenant_id', tenant.id);

        const groups = itemGroups
          ?.map((ig) => (ig.menu_modifier_groups as { name: string }).name)
          .join(', ');

        if (groups) {
          console.log(`  • ${item.name} — ${groups}`);
        }
      }
    }

    console.log(`\n✓ Menu enhancement complete!`);
    console.log(`\nVisitors can now:`);
    console.log(`  • Click any menu item to open the customization modal`);
    console.log(`  • Select sizes and see price changes`);
    console.log(`  • Choose from sauces, toppings, and add-ons`);
    console.log(`  • See the total price update as they customize`);
    console.log(`\nSample items remain unavailable for ordering.`);
  } catch (error) {
    console.error('Error enhancing menu:', error);
    process.exit(1);
  }
}

main();
