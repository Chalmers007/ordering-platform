-- =====================================================================
-- 20260902091000_menu_fk_disambiguation.sql
--
-- menu_items carried TWO foreign keys to menu_categories:
--
--   menu_items_category_id_fkey          (category_id)
--   menu_items_category_same_tenant_fk   (category_id, tenant_id)
--
-- The composite one is strictly stronger -- it enforces everything the
-- simple one did AND that the category belongs to the same tenant. The
-- simple one was pure redundancy.
--
-- It was not harmless, though: PostgREST refuses to embed a relationship
-- it cannot disambiguate, so `menu_categories?select=*,menu_items(*)`
-- failed with PGRST201 and the storefront rendered an empty menu. Naming
-- the constraint at each call site would have worked, but it would leave
-- the trap in place for the next query someone writes.
--
-- (customer_rewards also has two FKs to orders -- granted_for / redeemed_on.
-- Those are two genuinely different relationships, so they stay; any embed
-- of them must name the constraint.)
-- =====================================================================

alter table public.menu_items
  drop constraint if exists menu_items_category_id_fkey;

comment on constraint menu_items_category_same_tenant_fk on public.menu_items is
  'The only FK from menu_items to menu_categories. Carries tenant_id so a cross-tenant category reference is structurally impossible, and keeps the relationship unambiguous for PostgREST embeds.';
