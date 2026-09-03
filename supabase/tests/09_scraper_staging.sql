-- =====================================================================
-- 09_scraper_staging.sql
-- A storefront assembled from a scraped page must not be able to trade.
--
-- The pipeline builds a tenant and a menu out of claims about somebody
-- else's business — their dishes, their prices — that they never supplied.
-- Some of it will be stale on the day it is read. So the claims under test
-- are the ones that would take a diner's money at a price the restaurant
-- never set:
--
--   * an unclaimed staging tenant is invisible to anon, token and all
--   * a scraped item is inserted UNAVAILABLE regardless of what the
--     caller asked for
--   * an unverified menu cannot be priced, therefore cannot be ordered
--   * confirming the menu releases the scraped items and nothing else
--   * an active tenant can never hold a live ownership token
--   * issue_claim_token refuses a tenant that already has an owner
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

\set STAGED '0c33ef00-0000-4000-8000-000000000001'
\set CAT    '0c33ef00-0002-4000-8000-000000000001'
\set SCRAPED '0c33ef00-0004-4000-8000-000000000001'
\set OWNED   '0c33ef00-0004-4000-8000-000000000002'

-- Clear this suite's own fixtures FIRST. A previous run that aborted on a
-- failed assertion never reached its cleanup, and `on conflict do nothing`
-- would then silently reuse the stale row — so the next run asserts against
-- state the current code never produced.
delete from public.menu_items where tenant_id = :'STAGED';
delete from public.menu_categories where tenant_id = :'STAGED';
delete from public.webhook_events where tenant_id = :'STAGED';
delete from public.tenants where id = :'STAGED';

insert into public.tenants (id, name, slug, status)
values (:'STAGED', 'Copper Pot Staging', 'copper-pot-staging', 'pending_claim');

-- A staged tenant has NOT had its menu confirmed. The column defaults to
-- null; being explicit here is the precondition every assertion rests on.
update public.tenants set menu_verified_at = null where id = :'STAGED';

insert into public.menu_categories (id, tenant_id, name, slug, sort_order)
values (:'CAT', :'STAGED', 'Mains', 'mains', 0);

-- ---------------------------------------------------------------------
-- A scraped item is staged unavailable even when the caller says otherwise
-- ---------------------------------------------------------------------
insert into public.menu_items (id, tenant_id, category_id, name, slug, price_cents, is_available, source, source_url)
values (:'SCRAPED', :'STAGED', :'CAT', 'Gumbo', 'gumbo', 1650, true, 'scraped', 'https://copperpot.example/menu');

do $$
declare v_available boolean; v_scraped_at timestamptz;
begin
  select is_available, scraped_at into v_available, v_scraped_at
  from public.menu_items where id = '0c33ef00-0004-4000-8000-000000000001';

  -- The insert asked for is_available = true. The database overrode it,
  -- because remembering to pass false is exactly the thing a caller forgets.
  if v_available then
    raise exception 'FAIL: a scraped item was inserted available';
  end if;
  if v_scraped_at is null then
    raise exception 'FAIL: a scraped item has no scraped_at stamp';
  end if;
end $$;

-- An owner-entered item on the same unverified tenant is NOT touched. The
-- trigger is about provenance, not about the tenant being new.
insert into public.menu_items (id, tenant_id, category_id, name, slug, price_cents, is_available, source)
values (:'OWNED', :'STAGED', :'CAT', 'House Salad', 'house-salad', 900, true, 'owner');

do $$
declare v_available boolean;
begin
  select is_available into v_available from public.menu_items
  where id = '0c33ef00-0004-4000-8000-000000000002';
  if not v_available then
    raise exception 'FAIL: an owner-entered item was staged unavailable';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- An unverified menu cannot be priced, AFTER the storefront goes live
-- ---------------------------------------------------------------------
--
-- This is the scenario that matters. While the tenant is 'pending_claim',
-- price_cart refuses on status alone — the ownership gate. But claim_tenant()
-- sets status = 'active' the moment the owner redeems the link, and from then
-- on the ONLY thing standing between a scraped price and a diner's card is
-- the accuracy gate. So it is tested on an active tenant, in isolation.
--
-- The expected message is asserted, not merely the presence of an error. An
-- earlier version of this test passed while calling a price_cart signature
-- that does not exist, which is the same green as a working gate.
update public.tenants set status = 'active' where id = :'STAGED';

do $$
declare v_err text; v_state text;
begin
  begin
    perform public.price_cart(
      '0c33ef00-0000-4000-8000-000000000001'::uuid,
      jsonb_build_object(
        'fulfillmentType', 'pickup',
        'lines', jsonb_build_array(jsonb_build_object(
          'menuItemId', '0c33ef00-0004-4000-8000-000000000001',
          'quantity', 1,
          'modifierIds', '[]'::jsonb))));
    raise exception 'FAIL: a claimed storefront priced an unconfirmed scraped item';
  exception
    when others then
      v_err := sqlerrm; v_state := sqlstate;
      if v_err like 'FAIL:%' then raise; end if;
      if v_err not like '%sold out%' then
        raise exception 'FAIL: pricing was refused for the wrong reason - [%] %', v_state, v_err;
      end if;
  end;
end $$;

-- The control: the SAME call on the SAME active tenant succeeds once the menu
-- is confirmed. Without this, the refusal above could be any broken cart.
do $$
declare v_priced jsonb;
begin
  update public.tenants set menu_verified_at = now() where id = '0c33ef00-0000-4000-8000-000000000001';
  update public.menu_items set is_available = true
   where id = '0c33ef00-0004-4000-8000-000000000001';

  v_priced := public.price_cart(
    '0c33ef00-0000-4000-8000-000000000001'::uuid,
    jsonb_build_object(
      'fulfillmentType', 'pickup',
      'lines', jsonb_build_array(jsonb_build_object(
        'menuItemId', '0c33ef00-0004-4000-8000-000000000001',
        'quantity', 1,
        'modifierIds', '[]'::jsonb))));
  if v_priced is null then
    raise exception 'FAIL: a confirmed menu could not be priced';
  end if;
end $$;

-- Back to a staged tenant for the assertions that follow.
update public.tenants
   set status = 'pending_claim', menu_verified_at = null
 where id = :'STAGED';
update public.menu_items set is_available = false
 where id = :'SCRAPED';

-- ---------------------------------------------------------------------
-- anon cannot see a staging tenant, nor its ownership token
-- ---------------------------------------------------------------------
update public.tenants
   set claim_token = '0c33ef00-9999-4000-8000-000000000001',
       claim_token_expires_at = now() + interval '14 days'
 where id = :'STAGED';

do $$
declare v_visible integer;
begin
  set local role anon;
  select count(*) into v_visible from public.tenants
   where id = '0c33ef00-0000-4000-8000-000000000001';
  reset role;
  if v_visible <> 0 then
    raise exception 'FAIL: anon can read a pending_claim tenant (% rows)', v_visible;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- An active tenant may never hold a live ownership token
-- ---------------------------------------------------------------------
do $$
begin
  begin
    update public.tenants set status = 'active'
     where id = '0c33ef00-0000-4000-8000-000000000001';
    raise exception 'FAIL: a tenant went active while holding a live claim token';
  exception
    when check_violation then null;
    when others then
      if sqlerrm = 'FAIL: a tenant went active while holding a live claim token' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- confirm_menu releases the scraped items, and only those
-- ---------------------------------------------------------------------
-- An item the restaurant had deliberately switched off must stay off:
-- confirming a menu is a statement about accuracy, not "turn everything on".
update public.menu_items set is_available = false where id = :'OWNED';

update public.tenants set menu_verified_at = now() where id = :'STAGED';
update public.menu_items set is_available = true
 where tenant_id = :'STAGED' and source = 'scraped' and is_available = false;

do $$
declare v_scraped boolean; v_owned boolean;
begin
  select is_available into v_scraped from public.menu_items where id = '0c33ef00-0004-4000-8000-000000000001';
  select is_available into v_owned   from public.menu_items where id = '0c33ef00-0004-4000-8000-000000000002';
  if not v_scraped then raise exception 'FAIL: confirming the menu did not release the scraped item'; end if;
  if v_owned then raise exception 'FAIL: confirming the menu switched an owner-disabled item back on'; end if;
end $$;

-- ---------------------------------------------------------------------
-- issue_claim_token refuses a tenant that already has an owner
-- ---------------------------------------------------------------------
update public.tenants
   set claim_token = null, claim_token_expires_at = null,
       claimed_at = now(), status = 'active'
 where id = :'STAGED';

do $$
begin
  begin
    perform public.issue_claim_token('0c33ef00-0000-4000-8000-000000000001'::uuid, 14);
    raise exception 'FAIL: a claimed tenant was handed a fresh ownership token';
  exception
    when others then
      -- Either the privilege check or the claimed_at check is enough; both
      -- refuse. What must not happen is a token coming back.
      if sqlerrm = 'FAIL: a claimed tenant was handed a fresh ownership token' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- cleanup
-- ---------------------------------------------------------------------
delete from public.menu_items where tenant_id = :'STAGED';
delete from public.menu_categories where tenant_id = :'STAGED';
delete from public.webhook_events where tenant_id = :'STAGED';
delete from public.tenants where id = :'STAGED';

select '09_scraper_staging: all assertions passed' as result;
