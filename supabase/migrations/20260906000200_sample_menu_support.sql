-- =====================================================================
-- 20260906000200_sample_menu_support.sql
-- Enable sample menu items for demo storefronts
--
-- Sample menu items are polished demonstration menus for provisioning
-- demo storefronts. Unlike scraped items, sample items remain permanently
-- unavailable and non-orderable. They exist only to show prospective
-- customers a realistic storefront preview before claiming.
--
-- Sample items are NOT released by confirm_menu(). The owner must replace
-- them with a real menu (owner-entered or scraped) before ordering can be
-- enabled. This ensures demo storefronts never accidentally trade using
-- sample data.
--
-- This migration updates the menu_items.source CHECK constraint to allow
-- 'sample' values and ensures the trigger enforces permanent unavailability.
-- =====================================================================

set lock_timeout = '5s';

-- Update the CHECK constraint to allow 'sample' as a source
alter table public.menu_items drop constraint menu_items_source_chk;
alter table public.menu_items add constraint menu_items_source_chk
  check (source in ('owner', 'seed', 'scraped', 'sample'));

comment on column public.menu_items.source is
  'owner = entered or imported by the restaurant · seed = platform fixture · scraped = parsed from a public source and unverified until menu_verified_at is set · sample = polished demo menu for demo storefront, permanently unavailable and replaced before ordering.';

-- Update the trigger function to keep sample items permanently unavailable
-- Sample items are never released, even after confirm_menu().
create or replace function public.menu_items_stage_scraped()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_verified timestamptz;
begin
  -- Sample items are always unavailable. Never check menu_verified_at.
  if new.source = 'sample' then
    new.is_available := false;
    new.scraped_at := coalesce(new.scraped_at, now());
    return new;
  end if;

  -- Scraped items are unavailable until menu_verified_at is set.
  if new.source = 'scraped' then
    select menu_verified_at into v_verified from public.tenants where id = new.tenant_id;
    if v_verified is null then
      new.is_available := false;
      new.scraped_at := coalesce(new.scraped_at, now());
    end if;
    return new;
  end if;

  -- Owner and seed items pass through as-is.
  return new;
end;
$$;

-- confirm_menu() releases only scraped items, NOT sample items.
-- Sample items are permanent demo fixtures and must be replaced by the owner.
-- The function remains unchanged: it only releases 'scraped' source items.
-- No changes needed because the current logic already excludes 'sample'.
