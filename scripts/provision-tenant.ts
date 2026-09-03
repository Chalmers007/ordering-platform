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

  // ---- a menu ---------------------------------------------------------
  // A storefront with no menu renders an empty state — technically a 200,
  // but nothing anyone can order from, so it is not a real check.
  const { data: category } = await supabase
    .from('menu_categories')
    .upsert(
      { tenant_id: tenantId, name: 'Favourites', slug: 'favourites', sort_order: 0 },
      { onConflict: 'tenant_id,slug' },
    )
    .select('id')
    .single();

  if (!category) throw new Error('Could not create a menu category');

  const items = [
    { name: 'Margherita', slug: 'margherita', description: 'San Marzano, fior di latte, basil.', price_cents: 1400 },
    { name: 'Diavola', slug: 'diavola', description: 'Spicy salami, chilli, mozzarella.', price_cents: 1700 },
    { name: 'Garlic Knots', slug: 'garlic-knots', description: 'Six, with marinara.', price_cents: 700 },
  ];

  const { error: itemsError } = await supabase.from('menu_items').upsert(
    items.map((item, index) => ({
      ...item,
      tenant_id: tenantId,
      category_id: category.id,
      sort_order: index,
      is_taxable: true,
    })),
    { onConflict: 'tenant_id,slug' },
  );

  if (itemsError) throw new Error(`Could not create menu items: ${itemsError.message}`);
  console.log(`Seeded ${items.length} menu items`);

  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
  console.log(`\nStorefront: https://${slug}.${root}`);
}

main().catch((error: unknown) => {
  console.error(`\nProvisioning failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
