-- =====================================================================
-- 20260903001100_scraper_staging.sql
-- Staging a storefront built from data the restaurant never gave us.
--
-- A menu parsed off a website is a set of CLAIMS about someone else's
-- business: their dishes, their prices, their brand. Some of it will be
-- stale the day it is read. Publishing it as a working storefront would
-- take money from a diner at a price the restaurant never set.
--
-- So a scraped storefront is gated twice, on two independent axes:
--
--   1. OWNERSHIP — the tenant sits at 'pending_claim', which the
--      tenants_select policy hides from anon entirely. Nobody sees the
--      storefront until the owner redeems a claim link.
--
--   2. ACCURACY — every scraped item is inserted UNAVAILABLE, and
--      `tenants.menu_verified_at` stays null until a human confirms it.
--      Claiming makes the tenant active; it does NOT make a scraped menu
--      orderable.
--
-- The second gate needs no new enforcement code: price_cart() already
-- refuses an unavailable item, so an unconfirmed menu cannot be priced,
-- and therefore cannot be ordered. The rule is expressed where it is
-- already checked rather than added as a parallel guard that could drift.
-- =====================================================================

set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Accuracy gate
-- ---------------------------------------------------------------------

alter table public.tenants
  add column if not exists menu_verified_at timestamptz;

comment on column public.tenants.menu_verified_at is
  'When a human confirmed this menu is accurate. Null means the menu was assembled from data the restaurant did not supply and no scraped item may be ordered.';

-- Every tenant that exists today has an owner-supplied or fixture menu and
-- is already trading. Grandfathering them keeps this migration from
-- silently taking live storefronts offline.
update public.tenants set menu_verified_at = now() where menu_verified_at is null;

-- ---------------------------------------------------------------------
-- Provenance on the menu itself
-- ---------------------------------------------------------------------

do $$ begin
  alter table public.menu_items add column if not exists source text not null default 'owner';
exception when duplicate_column then null; end $$;

alter table public.menu_items add column if not exists source_url text;
alter table public.menu_items add column if not exists scraped_at timestamptz;

do $$ begin
  alter table public.menu_items add constraint menu_items_source_chk
    check (source in ('owner', 'seed', 'scraped'));
exception when duplicate_object then null; end $$;

comment on column public.menu_items.source is
  'owner = entered or imported by the restaurant · seed = platform fixture · scraped = parsed from a public source and unverified until menu_verified_at is set.';
comment on column public.menu_items.source_url is
  'Where a scraped item was read from, so a disputed price can be traced to its source.';

-- A scraped item starts unavailable, always. Enforced here rather than
-- trusted to every caller: the parser, the provisioning script and the
-- bridge route would each have to remember, and one forgetting is a live
-- storefront selling at a price nobody confirmed.
create or replace function public.menu_items_stage_scraped()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_verified timestamptz;
begin
  if new.source <> 'scraped' then
    return new;
  end if;
  select menu_verified_at into v_verified from public.tenants where id = new.tenant_id;
  if v_verified is null then
    new.is_available := false;
    new.scraped_at := coalesce(new.scraped_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists menu_items_stage_scraped on public.menu_items;
create trigger menu_items_stage_scraped
  before insert on public.menu_items
  for each row execute function public.menu_items_stage_scraped();

-- ---------------------------------------------------------------------
-- A live claim token may only sit on an unclaimed tenant
-- ---------------------------------------------------------------------
--
-- `tenants` carries a table-wide SELECT grant for anon, so every column it
-- will ever have is readable subject only to RLS — and the row policy is
-- what currently keeps claim_token out of reach (a 'pending_claim' tenant
-- is not 'active', so anon cannot select the row at all). That is one
-- layer, guarding a bearer credential that grants ownership.
--
-- This constraint removes the window rather than adding a second reader
-- check: a token can only exist while the tenant is unclaimed, and an
-- unclaimed tenant is never anon-readable. An 'active' row therefore never
-- carries a live token, whatever a future caller does.
do $$ begin
  alter table public.tenants add constraint tenants_claim_token_unclaimed_chk
    check (claim_token is null or status = 'pending_claim');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- issue_claim_token()
--
-- Nothing in this system could issue one. `verify_claim_token` and
-- `claim_tenant` both read the column and `claim_tenant` clears it, but no
-- function, route or script ever set it — so the claim flow could be
-- redeemed and never handed out.
--
-- SECURITY DEFINER, and the token is returned to the CALLER only. It is
-- generated server-side, never round-tripped through a browser role, and
-- re-issuing supersedes any previous token in the same statement.
-- ---------------------------------------------------------------------
create or replace function public.issue_claim_token(
  p_tenant_id uuid,
  p_ttl_days  integer default 14
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_token  uuid := gen_random_uuid();
begin
  if not public.is_super_admin() then
    raise exception 'Only a platform operator may issue a claim token'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'No such tenant' using errcode = 'no_data_found';
  end if;

  -- A claimed storefront has an owner. Handing out a fresh ownership token
  -- for it would let a stranger take a business off the person running it.
  if v_tenant.claimed_at is not null then
    raise exception 'This tenant has already been claimed'
      using errcode = 'check_violation';
  end if;
  if v_tenant.status in ('suspended', 'cancelled') then
    raise exception 'Cannot issue a claim token for a % tenant', v_tenant.status
      using errcode = 'check_violation';
  end if;

  update public.tenants
     set claim_token = v_token,
         claim_token_expires_at = now() + make_interval(days => greatest(1, coalesce(p_ttl_days, 14))),
         status = 'pending_claim',
         updated_at = now()
   where id = p_tenant_id;

  return v_token;
end;
$$;

revoke all on function public.issue_claim_token(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- confirm_menu()
--
-- The owner's statement that the menu is right. This is the only thing
-- that makes a scraped menu orderable, and it is deliberately a separate
-- act from claiming: taking possession of a storefront is not the same as
-- vouching for prices somebody else assembled.
-- ---------------------------------------------------------------------
create or replace function public.confirm_menu(p_tenant_id uuid)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
begin
  if not public.can_manage_tenant(p_tenant_id) then
    raise exception 'Only the restaurant may confirm its own menu'
      using errcode = 'insufficient_privilege';
  end if;

  update public.tenants
     set menu_verified_at = now(), updated_at = now()
   where id = p_tenant_id
  returning * into v_tenant;

  -- Only the scraped rows are released. An item the owner had already
  -- switched off stays off; confirming a menu is not "turn everything on".
  update public.menu_items
     set is_available = true, updated_at = now()
   where tenant_id = p_tenant_id
     and source = 'scraped'
     and is_available = false;

  return v_tenant;
end;
$$;

revoke all on function public.confirm_menu(uuid) from public, anon;
grant execute on function public.confirm_menu(uuid) to authenticated;
