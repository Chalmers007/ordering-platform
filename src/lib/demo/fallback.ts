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
import { enhanceSampleMenu } from '@/lib/storefront/enhance-sample-menu';

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

/** Curated, high-resolution images used only by generated demo menus. */
export const FOOD_IMAGES = {
  pizza: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80',
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80',
  tacos: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=600&q=80',
  sushi: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=600&q=80',
  pasta: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281288?auto=format&fit=crop&w=600&q=80',
  wings: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=600&q=80',
  appetizer: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=600&q=80',
  dessert: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=600&q=80',
  drinks: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
} as const;

/** Dish-specific photography takes precedence over cuisine/category defaults. */
export const FOOD_ITEM_IMAGES = {
  'garlic bread': 'https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?auto=format&fit=crop&w=600&q=80',
  'mozzarella sticks': 'https://images.unsplash.com/photo-1531749668029-2db88e4276c7?auto=format&fit=crop&w=600&q=80',
  'shrimp tempura': 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=600&q=80',
  'shrimp scampi': 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=600&q=80',
  'spring rolls': 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80',
  nachos: 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?auto=format&fit=crop&w=600&q=80',
  pasta: FOOD_IMAGES.pasta,
  lasagna: FOOD_IMAGES.pasta,
  'chicken parmesan': FOOD_IMAGES.pasta,
  'grilled salmon': 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=600&q=80',
  'ribeye steak': 'https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=600&q=80',
} as const;

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
type SampleMenu = {
  categories: Array<{
    name: string;
    items: Array<{ name: string; description?: string; priceCents: number; imageUrl?: string }>;
  }>;
};

function generateGenericSampleMenu(): SampleMenu {
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

const FOOD_TYPE_MENUS: Record<string, SampleMenu> = {
  mexican: {
    categories: [
      { name: 'Tacos', items: [
        { name: 'Carne Asada Tacos', description: 'Grilled steak, onion, cilantro and salsa', priceCents: 1299 },
        { name: 'Baja Fish Tacos', description: 'Crispy fish, cabbage slaw and crema', priceCents: 1399 },
        { name: 'Tinga Chicken Tacos', description: 'Smoky pulled chicken with avocado salsa', priceCents: 1199 },
      ] },
      { name: 'Burritos & Bowls', items: [
        { name: 'California Burrito', description: 'Carne asada, fries, cheese and pico', priceCents: 1599 },
        { name: 'Chicken Fajita Bowl', description: 'Rice, beans, peppers, guacamole and crema', priceCents: 1499 },
        { name: 'Chile Verde Burrito', description: 'Slow-braised pork, tomatillo sauce and rice', priceCents: 1549 },
      ] },
      { name: 'Chips & Sweets', items: [
        { name: 'Guacamole & Chips', description: 'Fresh avocado, lime, cilantro and tortilla chips', priceCents: 899 },
        { name: 'Street Corn', description: 'Roasted corn, cotija, crema and chile', priceCents: 699 },
        { name: 'Churros', description: 'Cinnamon sugar churros with chocolate dip', priceCents: 749 },
      ] },
    ],
  },
  'asian-fusion': {
    categories: [
      { name: 'Sushi & Small Plates', items: [
        { name: 'Crispy Tuna Roll', description: 'Spicy tuna, cucumber, avocado and crispy rice', priceCents: 1499 },
        { name: 'Gyoza', description: 'Pan-seared pork dumplings with ginger soy', priceCents: 899 },
        { name: 'Korean Wings', description: 'Crispy wings glazed with gochujang and sesame', priceCents: 1299 },
      ] },
      { name: 'Ramen & Rice', items: [
        { name: 'Miso Ramen', description: 'Miso broth, noodles, pork belly and soft egg', priceCents: 1699 },
        { name: 'Teriyaki Rice Bowl', description: 'Grilled chicken, jasmine rice and pickled vegetables', priceCents: 1499 },
        { name: 'Thai Basil Noodles', description: 'Rice noodles, vegetables, basil and chili', priceCents: 1399 },
      ] },
      { name: 'Dessert & Drinks', items: [
        { name: 'Mochi Trio', description: 'Three seasonal ice cream mochi', priceCents: 699 },
        { name: 'Mango Sticky Rice', description: 'Sweet coconut rice with fresh mango', priceCents: 799 },
        { name: 'Yuzu Lemonade', description: 'Bright citrus lemonade with yuzu', priceCents: 499 },
      ] },
    ],
  },
  pizza: {
    categories: [
      { name: 'Pizzas', items: [
        { name: 'Margherita', description: 'Tomato, fresh mozzarella, basil and olive oil', priceCents: 1599 },
        { name: 'Pepperoni', description: 'Cup-and-char pepperoni, mozzarella and tomato', priceCents: 1799 },
        { name: 'Spicy Honey Soppressata', description: 'Soppressata, hot peppers, mozzarella and chili honey', priceCents: 1999 },
      ] },
      { name: 'Starters & Sides', items: [
        { name: 'Garlic Knots', description: 'Oven-baked knots with garlic butter and parmesan', priceCents: 699 },
        { name: 'Burrata Caprese', description: 'Creamy burrata, tomatoes, basil and balsamic', priceCents: 1199 },
        { name: 'Wings', description: 'Crispy wings tossed in your choice of sauce', priceCents: 1199 },
      ] },
      { name: 'Desserts', items: [
        { name: 'Tiramisu', description: 'Espresso-soaked ladyfingers with mascarpone', priceCents: 749 },
        { name: 'Cannoli', description: 'Sweet ricotta, chocolate and pistachio', priceCents: 699 },
        { name: 'Chocolate Chip Cookie', description: 'Warm skillet cookie with sea salt', priceCents: 599 },
      ] },
    ],
  },
  burger: {
    categories: [
      { name: 'Burgers', items: [
        { name: 'Classic Cheeseburger', description: 'Griddled beef, American cheese, lettuce and pickles', priceCents: 1399 },
        { name: 'Bacon BBQ Burger', description: 'Bacon, cheddar, crispy onions and smoky BBQ sauce', priceCents: 1699 },
        { name: 'Crispy Chicken Sandwich', description: 'Buttermilk fried chicken, slaw and spicy mayo', priceCents: 1499 },
      ] },
      { name: 'Fries & Sides', items: [
        { name: 'Sea Salt Fries', description: 'Crispy hand-cut fries with house seasoning', priceCents: 499 },
        { name: 'Loaded Cheese Fries', description: 'Fries with cheese sauce, bacon and scallions', priceCents: 899 },
        { name: 'House Side Salad', description: 'Greens, tomato, cucumber and ranch', priceCents: 699 },
      ] },
      { name: 'Shakes & Sweets', items: [
        { name: 'Vanilla Bean Shake', description: 'Hand-spun vanilla shake with whipped cream', priceCents: 699 },
        { name: 'Chocolate Shake', description: 'Rich chocolate shake with whipped cream', priceCents: 699 },
        { name: 'Salted Caramel Brownie', description: 'Warm brownie with salted caramel drizzle', priceCents: 799 },
      ] },
    ],
  },
  italian: {
    categories: [
      { name: 'Pasta', items: [
        { name: 'Tagliatelle Bolognese', description: 'Fresh pasta with slow-simmered beef ragu', priceCents: 1799 },
        { name: 'Chicken Parmesan', description: 'Crispy chicken, marinara, mozzarella and spaghetti', priceCents: 1699 },
        { name: 'Shrimp Scampi', description: 'Garlic shrimp, lemon butter and linguine', priceCents: 1899 },
      ] },
      { name: 'Pizza & Antipasti', items: [
        { name: 'Margherita Pizza', description: 'Tomato, mozzarella, basil and olive oil', priceCents: 1599 },
        { name: 'Burrata & Prosciutto', description: 'Creamy burrata, prosciutto and grilled bread', priceCents: 1399 },
        { name: 'Garlic Focaccia', description: 'Warm rosemary focaccia with whipped ricotta', priceCents: 699 },
      ] },
      { name: 'Dolci', items: [
        { name: 'Tiramisu', description: 'Espresso, mascarpone and cocoa', priceCents: 749 },
        { name: 'Panna Cotta', description: 'Vanilla cream with seasonal berries', priceCents: 699 },
        { name: 'Cannoli', description: 'Sweet ricotta, chocolate and pistachio', priceCents: 699 },
      ] },
    ],
  },
};

function menuKey(foodType: string | undefined): string | null {
  const normalized = (foodType ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (/asian|sushi|ramen|thai|japanese|chinese/.test(normalized)) return 'asian-fusion';
  if (/mexic|taco|burrito/.test(normalized)) return 'mexican';
  if (/pizza/.test(normalized)) return 'pizza';
  if (/burger|hamburger|american/.test(normalized)) return 'burger';
  if (/italian|pasta/.test(normalized)) return 'italian';
  return null;
}

type FoodImageKey = keyof typeof FOOD_IMAGES;

function fallbackImageKey(foodType: string | undefined): FoodImageKey {
  const key = menuKey(foodType);
  if (key === 'mexican') return 'tacos';
  if (key === 'asian-fusion') return 'sushi';
  if (key === 'pizza') return 'pizza';
  if (key === 'burger') return 'burger';
  if (key === 'italian') return 'pasta';
  return 'pasta';
}

function imageUrlForItem(itemName: string, categoryName: string, foodType?: string): string {
  const name = itemName.trim().toLowerCase();
  const specific = Object.entries(FOOD_ITEM_IMAGES).find(([keyword]) => name.includes(keyword));
  if (specific) return specific[1];

  const text = `${categoryName} ${name}`.toLowerCase();
  let key: FoodImageKey = fallbackImageKey(foodType);
  if (/dessert|sweet|cake|tiramisu|panna cotta|cannoli|churro|brownie|mousse|sorbet|pie/.test(text)) key = 'dessert';
  else if (/drink|shake|lemonade|tea|soda|juice|cocktail/.test(text)) key = 'drinks';
  else if (/wing/.test(text)) key = 'wings';
  else if (/appetizer|starter|nacho|fries|bruschetta/.test(text)) key = 'appetizer';
  else if (/pizza/.test(text)) key = 'pizza';
  else if (/burger|hamburger|sandwich|fries/.test(text)) key = 'burger';
  else if (/taco|burrito|enchilada|quesadilla|guacamole|nacho|corn/.test(text)) key = 'tacos';
  else if (/sushi|roll|ramen|noodle|gyoza|dumpling|miso|teriyaki/.test(text)) key = 'sushi';
  else if (/pasta|lasagna|parmesan|scampi|risotto|focaccia|bruschetta|caprese/.test(text)) key = 'pasta';
  return FOOD_IMAGES[key];
}

function attachFoodImages(menu: SampleMenu, foodType?: string): SampleMenu {
  return {
    categories: menu.categories.map((category) => ({
      ...category,
      items: category.items.map((item) => ({
        ...item,
        imageUrl: imageUrlForItem(item.name, category.name, foodType),
      })),
    })),
  };
}

export function generateSampleMenu(foodType?: string): SampleMenu {
  const key = menuKey(foodType);
  return attachFoodImages(key ? FOOD_TYPE_MENUS[key] : generateGenericSampleMenu(), foodType);
}

/** Render the fallback menu in the schema.org JSON-LD format the existing
 * structured parser consumes. */
export function sampleMenuContent(name: string, foodType?: string): string {
  const menu = generateSampleMenu(foodType);
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
            name: 'Protein',
            description: 'Choose your protein type',
            additionalProperty: [
              { '@type': 'PropertyValue', name: 'type', value: 'modifier_group' },
              { '@type': 'PropertyValue', name: 'selection_type', value: 'multiple' },
            ],
            hasMenuItemOption: [
              { '@type': 'MenuItemOption', name: 'Chicken', price: '0.00' },
              { '@type': 'MenuItemOption', name: 'Beef', price: '1.50' },
              { '@type': 'MenuItemOption', name: 'Fish', price: '2.00' },
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
          image: item.imageUrl,
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
  claim_token?: string;
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
    content: sampleMenuContent(input.name, input.category),
    sourceUrl: 'sample-menu://fallback-demo',
    nameHint: input.name,
    sampleMenu: true,
  };

  const staged = await parseAndStage(stageInput);

  // Add modifiers to sample menu items for demo preview (stageInput.sampleMenu indicates a demo)
  if (stageInput.sampleMenu) {
    await enhanceSampleMenu({ tenantId: staged.tenantId, db });
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
    slug: staged.slug,
    // The path preview route resolves by tenant UUID; the human-readable slug
    // is returned separately for callers that need it.
    preview_url: buildPreviewUrl(staged.tenantId),
    state: 'created',
    claim_token: staged.claimToken,
  };
}

/**
 * Add representative modifiers to sample menu items.
 * Creates Protein and Add-ons modifier groups.
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

    // Create Protein Option modifier group (replaces Size - database constraint on 'single' type)
    // Using 'multiple' selection with max=1 and is_required=false with min=1
    const { data: sizeGroup, error: sizeGroupError } = await db
      .from('menu_modifier_groups')
      .insert({
        tenant_id: tenantId,
        name: 'Protein',
        description: 'Choose your protein type',
        selection_type: 'multiple',
        is_active: true,
        is_required: false,
        min_selections: 1,
        max_selections: 1,
      })
      .select('id')
      .single();

    if (sizeGroupError) {
      console.warn('Failed to create protein modifier group:', sizeGroupError);
    }

    if (sizeGroup) {
      console.log('Protein group created:', sizeGroup.id);

      // Add protein options
      const proteins = [
        { name: 'Chicken', price_delta_cents: 0, is_default: false },
        { name: 'Beef', price_delta_cents: 150, is_default: false },
        { name: 'Fish', price_delta_cents: 200, is_default: false },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: modifiersData, error: modifierError } = await (db as any).from('menu_modifiers').insert(
        proteins.map((p, i) => ({
          tenant_id: tenantId,
          group_id: sizeGroup.id,
          name: p.name,
          price_delta_cents: p.price_delta_cents,
          is_default: p.is_default,
          is_available: true,
          sort_order: i,
        })),
      );

      if (modifierError) {
        console.warn('Failed to add protein modifiers:', modifierError);
      } else {
        console.log('Protein modifiers inserted:', modifiersData?.length ?? 'OK');
      }
    } else {
      console.warn('Protein group was not created');
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
      console.log('Toppings group created:', toppingsGroup.id);

      const toppings = [
        { name: 'Extra Cheese', price_delta_cents: 75 },
        { name: 'Extra Protein', price_delta_cents: 200 },
        { name: 'Garlic & Herbs', price_delta_cents: 50 },
        { name: 'Extra Vegetables', price_delta_cents: 75 },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: modifiersData, error: modifierError } = await (db as any).from('menu_modifiers').insert(
        toppings.map((t, i) => ({
          tenant_id: tenantId,
          group_id: toppingsGroup.id,
          name: t.name,
          price_delta_cents: t.price_delta_cents,
          is_default: false,
          is_available: true,
          sort_order: i,
        })),
      );

      if (modifierError) {
        console.warn('Failed to add topping modifiers:', modifierError);
      } else {
        console.log('Topping modifiers inserted:', modifiersData?.length ?? 'returned data');
      }
    } else {
      console.warn('Toppings group was not created');
    }

    // Link modifier groups to specific items
    if (sizeGroup && toppingsGroup) {
      const linkCount = items.length * 2;
      console.log(`Linking ${linkCount} modifier groups to ${items.length} items`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkError } = await (db as any).from('menu_item_modifier_groups').insert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items.flatMap((item: any) => [
          { tenant_id: tenantId, item_id: item.id, group_id: sizeGroup.id, sort_order: 0 },
          { tenant_id: tenantId, item_id: item.id, group_id: toppingsGroup.id, sort_order: 1 },
        ]),
      );

      if (linkError) {
        console.warn('Failed to link modifier groups to items:', linkError);
      } else {
        console.log('Modifier groups linked successfully');
      }
    } else {
      console.warn('Cannot link: sizeGroup=' + !!sizeGroup + ', toppingsGroup=' + !!toppingsGroup);
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
