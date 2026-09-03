-- =====================================================================
-- 20260903000200_tenant_claim.sql
-- Outreach claim links.
--
-- A restaurant gets a storefront built for it in advance, then a link that
-- lets the owner take possession of it. The token in that link is a bearer
-- credential that grants OWNERSHIP of a tenant, so it is treated like one:
-- random, expiring, single-use, and never readable by any browser role.
--
-- The token lives on `tenants`, which anon can read — but only for rows
-- with status = 'active'. A tenant awaiting claim is 'pending_claim', so
-- the row (and therefore the token) is invisible to anon by policy, not by
-- omission. Verification goes through a SECURITY DEFINER function that
-- returns a name and a couple of counts and never echoes the token back.
-- =====================================================================

set check_function_bodies = off;

-- Used only inside function bodies below, which Postgres does not evaluate
-- at creation time; a literal use in DML here would fail with "unsafe use
-- of new value".
alter type public.tenant_status add value if not exists 'pending_claim';

alter table public.tenants
  add column if not exists claim_token uuid,
  add column if not exists claim_token_expires_at timestamptz,
  add column if not exists claimed_at timestamptz;

-- Partial and unique: two live tokens must never collide, but a claimed
-- tenant has NULL and many of those are fine.
create unique index if not exists tenants_claim_token_key
  on public.tenants (claim_token) where claim_token is not null;

comment on column public.tenants.claim_token is
  'Single-use bearer token granting ownership. Cleared on claim. Never exposed to a client role.';

-- ---------------------------------------------------------------------
-- verify_claim_token()
--
-- What the claim page renders before anyone signs in, so it must be
-- callable by anon — and must therefore reveal nothing but the restaurant
-- being claimed. It returns no token, no email, no other tenant.
-- ---------------------------------------------------------------------
create or replace function public.verify_claim_token(p_token uuid)
returns table (
  tenant_id      uuid,
  name           text,
  slug           text,
  category_count bigint,
  item_count     bigint,
  expires_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.name,
    t.slug,
    (select count(*) from public.menu_categories c where c.tenant_id = t.id and c.is_active),
    (select count(*) from public.menu_items i where i.tenant_id = t.id),
    t.claim_token_expires_at
  from public.tenants t
  where t.claim_token = p_token
    and t.status = 'pending_claim'
    and (t.claim_token_expires_at is null or t.claim_token_expires_at > now());
$$;

-- ---------------------------------------------------------------------
-- claim_tenant()
--
-- Completes the handover in one transaction: the profile becomes owner,
-- the tenant goes live, and the token is destroyed. Service-role only —
-- it is called after the auth user has been created, which only the admin
-- API can do.
--
-- The token is re-checked here rather than trusted from the verify step,
-- because between the two the link could have expired or been used.
-- ---------------------------------------------------------------------
create or replace function public.claim_tenant(
  p_token     uuid,
  p_user_id   uuid,
  p_email     text,
  p_full_name text default null,
  p_phone     text default null
)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
begin
  -- FOR UPDATE: two people opening the same emailed link at once must not
  -- both become the owner.
  select * into v_tenant
  from public.tenants
  where claim_token = p_token
    and status = 'pending_claim'
    and (claim_token_expires_at is null or claim_token_expires_at > now())
  for update;

  if not found then
    raise exception 'This claim link is not valid, has expired, or has already been used'
      using errcode = 'no_data_found';
  end if;

  perform set_config('app.audit_operation', 'CLAIM_TENANT', true);

  insert into public.user_profiles (id, tenant_id, role, full_name, email, phone)
  values (p_user_id, v_tenant.id, 'tenant_owner',
          nullif(btrim(coalesce(p_full_name, '')), ''),
          nullif(btrim(coalesce(p_email, '')), ''),
          nullif(btrim(coalesce(p_phone, '')), ''))
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        role = 'tenant_owner',
        full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
        email = coalesce(excluded.email, public.user_profiles.email),
        phone = coalesce(excluded.phone, public.user_profiles.phone);

  update public.tenants
     set status = 'active',
         claimed_at = now(),
         onboarded_at = coalesce(onboarded_at, now()),
         support_email = coalesce(support_email, nullif(btrim(coalesce(p_email, '')), '')),
         -- Destroyed, not merely expired: a link that has been used must
         -- not work again even before its expiry.
         claim_token = null,
         claim_token_expires_at = null
   where id = v_tenant.id
  returning * into v_tenant;

  insert into public.webhook_events (tenant_id, event_type, payload)
  values (
    v_tenant.id, 'tenant.provisioned',
    jsonb_build_object(
      'tenantId', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name,
      'claimedAt', v_tenant.claimed_at, 'ownerEmail', p_email
    )
  );

  return v_tenant;
end;
$$;

-- verify is public (the claim page runs before login); claim is not.
revoke all on function public.verify_claim_token(uuid) from public, anon, authenticated;
revoke all on function public.claim_tenant(uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.verify_claim_token(uuid) to anon, authenticated;
