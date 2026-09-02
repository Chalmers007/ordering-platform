-- =====================================================================
-- supabase/seed.sql
-- Demo restaurant, applied automatically by `supabase db reset`.
--
-- Deliberately contains no auth users and no orders:
--   * auth users need passwords, which belong in scripts/seed-demo.ts
--     where the admin API can set them (and which also works against a
--     remote project, where psql is not available);
--   * seeded orders would move the aggregates the SQL suites assert on.
--
-- Every statement is idempotent, so a reset is repeatable.
-- =====================================================================

-- Fixed ids so the seeder and the browser pass can address rows directly.
insert into public.tenants (id, slug, name, legal_name, support_email, support_phone,
                            status, timezone, currency, subscription_status, onboarded_at)
values (
  '0a11ce00-0000-4000-8000-000000000001',
  'joespizza',
  'Joe''s Authentic Pizzeria',
  'Joe''s Authentic Pizzeria LLC',
  'hello@joespizza.test',
  '+19195550142',
  'active',
  'America/New_York',
  'USD',
  'active',
  now()
)
on conflict (id) do nothing;

-- The tenants trigger already created a settings row; this applies the
-- demo configuration on top of it.
update public.tenant_settings set
  tagline                  = 'Wood-fired since 1994',
  description              = 'Neapolitan pizza, hand-stretched daily.',
  brand_primary_color      = '#1f2937',
  brand_accent_color       = '#dc2626',
  tech_fee_enabled         = true,
  tech_fee_cents           = 100,
  estimated_prep_time_mins = 20,
  accepts_delivery         = true,
  accepts_pickup           = true,
  delivery_fee_cents       = 499,
  delivery_minimum_cents   = 1500,
  service_fee_bps          = 0,
  tax_rate_bps             = 875,
  default_tip_bps          = 1800,
  address_line1            = '218 Fayetteville St',
  city                     = 'Raleigh',
  region                   = 'NC',
  postal_code              = '27601',
  country                  = 'US',
  latitude                 = 35.7770,
  longitude                = -78.6386,
  business_hours           = '[{"dow":1,"open":"11:00","close":"22:00"},
                               {"dow":2,"open":"11:00","close":"22:00"},
                               {"dow":3,"open":"11:00","close":"22:00"},
                               {"dow":4,"open":"11:00","close":"22:00"},
                               {"dow":5,"open":"11:00","close":"23:00"},
                               {"dow":6,"open":"12:00","close":"23:00"},
                               {"dow":0,"open":"12:00","close":"21:00"}]'::jsonb
where tenant_id = '0a11ce00-0000-4000-8000-000000000001';

-- ---- categories -----------------------------------------------------
insert into public.menu_categories (id, tenant_id, name, slug, description, sort_order)
values
  ('0a11ce00-0001-4000-8000-000000000001','0a11ce00-0000-4000-8000-000000000001',
   'Pizzas','pizzas','Hand-stretched, 90 seconds in the wood oven.', 0),
  ('0a11ce00-0001-4000-8000-000000000002','0a11ce00-0000-4000-8000-000000000001',
   'Starters','starters','Something while the oven does its work.', 1),
  ('0a11ce00-0001-4000-8000-000000000003','0a11ce00-0000-4000-8000-000000000001',
   'Drinks','drinks',null, 2)
on conflict (id) do nothing;

-- ---- modifier groups ------------------------------------------------
insert into public.menu_modifier_groups
  (id, tenant_id, name, description, selection_type, is_required, min_selections, max_selections, sort_order)
values
  ('0a11ce00-0002-4000-8000-000000000001','0a11ce00-0000-4000-8000-000000000001',
   'Size', null, 'single', true, 1, 1, 0),
  ('0a11ce00-0002-4000-8000-000000000002','0a11ce00-0000-4000-8000-000000000001',
   'Crust', null, 'single', true, 1, 1, 1),
  ('0a11ce00-0002-4000-8000-000000000003','0a11ce00-0000-4000-8000-000000000001',
   'Toppings', 'Up to four.', 'multiple', false, 0, 4, 2)
on conflict (id) do nothing;

insert into public.menu_modifiers
  (id, tenant_id, group_id, name, price_delta_cents, is_default, sort_order)
values
  -- Size
  ('0a11ce00-0003-4000-8000-000000000001','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000001','10" personal',    0, true,  0),
  ('0a11ce00-0003-4000-8000-000000000002','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000001','14" medium',    400, false, 1),
  ('0a11ce00-0003-4000-8000-000000000003','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000001','18" large',     800, false, 2),
  -- Crust
  ('0a11ce00-0003-4000-8000-000000000004','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000002','Classic',         0, true,  0),
  ('0a11ce00-0003-4000-8000-000000000005','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000002','Thin & crispy',   0, false, 1),
  ('0a11ce00-0003-4000-8000-000000000006','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000002','Gluten free',   300, false, 2),
  -- Toppings
  ('0a11ce00-0003-4000-8000-000000000007','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000003','Extra mozzarella',150, false, 0),
  ('0a11ce00-0003-4000-8000-000000000008','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000003','Pepperoni',      200, false, 1),
  ('0a11ce00-0003-4000-8000-000000000009','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000003','Kalamata olives',150, false, 2),
  ('0a11ce00-0003-4000-8000-00000000000a','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000003','Fresh basil',      0, false, 3),
  ('0a11ce00-0003-4000-8000-00000000000b','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000003','Hot honey',      100, false, 4)
on conflict (id) do nothing;

-- ---- items ----------------------------------------------------------
insert into public.menu_items
  (id, tenant_id, category_id, name, slug, description, price_cents, is_taxable,
   is_featured, sort_order, dietary_tags, allergens, prep_time_mins)
values
  ('0a11ce00-0004-4000-8000-000000000001','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000001',
   'Margherita','margherita','San Marzano, fior di latte, basil.', 1400, true, true, 0,
   '{vegetarian}', '{gluten,dairy}', 12),
  ('0a11ce00-0004-4000-8000-000000000002','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000001',
   'Diavola','diavola','Spicy salami, chilli, mozzarella.', 1700, true, false, 1,
   '{spicy}', '{gluten,dairy}', 12),
  ('0a11ce00-0004-4000-8000-000000000003','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000001',
   'Quattro Formaggi','quattro-formaggi','Mozzarella, gorgonzola, fontina, parmesan.', 1800, true, false, 2,
   '{vegetarian}', '{gluten,dairy}', 14),
  ('0a11ce00-0004-4000-8000-000000000004','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000002',
   'Garlic Knots','garlic-knots','Six, with marinara.', 700, true, false, 0,
   '{vegetarian}', '{gluten}', 6),
  ('0a11ce00-0004-4000-8000-000000000005','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000002',
   'Caesar Salad','caesar-salad','Romaine, parmesan, focaccia croutons.', 900, true, false, 1,
   '{}', '{gluten,dairy,fish}', 5),
  -- Deliberately sold out, so the storefront's "Sold out" state is visible
  -- in the demo rather than only in tests.
  ('0a11ce00-0004-4000-8000-000000000006','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000002',
   'Burrata','burrata','With olive oil and sea salt.', 1100, true, false, 2,
   '{vegetarian}', '{dairy}', 4),
  ('0a11ce00-0004-4000-8000-000000000007','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000003',
   'San Pellegrino','san-pellegrino',null, 350, true, false, 0, '{}', '{}', 1),
  ('0a11ce00-0004-4000-8000-000000000008','0a11ce00-0000-4000-8000-000000000001','0a11ce00-0001-4000-8000-000000000003',
   'Italian Soda','italian-soda','Blood orange or lemon.', 400, true, false, 1, '{}', '{}', 1)
on conflict (id) do nothing;

update public.menu_items set is_available = false
 where id = '0a11ce00-0004-4000-8000-000000000006';

-- ---- which groups apply to which items -------------------------------
insert into public.menu_item_modifier_groups (tenant_id, item_id, group_id, sort_order)
select '0a11ce00-0000-4000-8000-000000000001', item_id, group_id, sort_order
from (values
  ('0a11ce00-0004-4000-8000-000000000001'::uuid,'0a11ce00-0002-4000-8000-000000000001'::uuid,0),
  ('0a11ce00-0004-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000002',1),
  ('0a11ce00-0004-4000-8000-000000000001','0a11ce00-0002-4000-8000-000000000003',2),
  ('0a11ce00-0004-4000-8000-000000000002','0a11ce00-0002-4000-8000-000000000001',0),
  ('0a11ce00-0004-4000-8000-000000000002','0a11ce00-0002-4000-8000-000000000002',1),
  ('0a11ce00-0004-4000-8000-000000000002','0a11ce00-0002-4000-8000-000000000003',2),
  ('0a11ce00-0004-4000-8000-000000000003','0a11ce00-0002-4000-8000-000000000001',0),
  ('0a11ce00-0004-4000-8000-000000000003','0a11ce00-0002-4000-8000-000000000002',1)
) as t(item_id, group_id, sort_order)
on conflict (item_id, group_id) do nothing;

-- ---- integrations ----------------------------------------------------
-- Placeholder credentials so the demo tenant is wired end to end. Real
-- values are set per tenant from the dashboard; these are never readable
-- by any browser role (tenant_secrets has RLS on and zero policies).
insert into public.tenant_secrets (tenant_id, key, value)
values
  ('0a11ce00-0000-4000-8000-000000000001','shipday_api_key','demo-not-a-real-courier-key'),
  ('0a11ce00-0000-4000-8000-000000000001','ghl_webhook_url','https://example.invalid/ghl/demo')
on conflict (tenant_id, key) do nothing;

insert into public.payment_gateway_accounts
  (tenant_id, provider, status, is_default, external_account_id,
   charges_enabled, payouts_enabled, details_submitted, account_type)
values
  ('0a11ce00-0000-4000-8000-000000000001','stripe','active', true,
   'acct_demoJoesPizzaConnected', true, true, true, 'express')
on conflict (tenant_id, provider) do nothing;
