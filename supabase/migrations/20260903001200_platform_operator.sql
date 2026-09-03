-- =====================================================================
-- 20260903001200_platform_operator.sql
-- Let the server itself provision, not only a signed-in administrator.
--
-- provision_tenant() and issue_claim_token() both gate on is_super_admin(),
-- which resolves auth.uid() against user_profiles. That is exactly right
-- for the admin dashboard, and impossible for a machine: vardr-os calls
-- the provisioning bridge with a shared secret and no Supabase session, so
-- auth.uid() is null and both functions refuse.
--
-- ── Why widening this gives nothing away ─────────────────────────────────
-- The service role already bypasses RLS entirely. A caller holding that key
-- can insert into public.tenants directly today; refusing it the RPC does
-- not protect the table, it only pushes callers into reimplementing the
-- function badly — without the slug checks, the onboarding defaults or the
-- tenant.provisioned event.
--
-- What actually guards the bridge is one layer up: the endpoint compares a
-- 32+ character secret in constant time and fails closed when unset. See
-- src/lib/admin/bridge-secret.ts.
--
-- anon and authenticated are unaffected. They were never service_role and
-- still resolve through is_super_admin().
-- =====================================================================

set lock_timeout = '5s';

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_super_admin() or auth.role() = 'service_role';
$$;

comment on function public.is_platform_operator is
  'A signed-in super admin, or the server acting as itself. The service role already bypasses RLS, so this grants it nothing new — it lets the server reach the same vetted function the dashboard uses instead of writing the table by hand.';

revoke all on function public.is_platform_operator() from public, anon;
grant execute on function public.is_platform_operator() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Re-gate the two functions the bridge needs.
--
-- Only the guard changes. Everything else in provision_tenant — the slug
-- derivation, the collision check, the onboarding defaults, the
-- tenant.provisioned event — is untouched, so the dashboard and the bridge
-- provision through exactly the same code.
-- ---------------------------------------------------------------------
create or replace function public.provision_tenant(
  p_name          text,
  p_slug          text default null,
  p_support_email text default null,
  p_support_phone text default null,
  p_timezone      text default 'America/New_York',
  p_currency      char(3) default 'USD',
  p_trial_days    integer default 14
)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_slug   text;
begin
  if not public.is_platform_operator() then
    raise exception 'Only a platform administrator may provision a restaurant'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(length(btrim(p_name)), 0) = 0 then
    raise exception 'A restaurant name is required' using errcode = 'check_violation';
  end if;

  v_slug := coalesce(nullif(btrim(lower(p_slug)), ''), public.slugify_tenant_name(p_name));

  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'The subdomain "%" is already taken', v_slug
      using errcode = 'unique_violation';
  end if;

  insert into public.tenants (
    slug, name, support_email, support_phone, status, timezone, currency,
    subscription_status, trial_ends_at
  ) values (
    v_slug, btrim(p_name),
    nullif(btrim(coalesce(p_support_email, '')), ''),
    nullif(btrim(coalesce(p_support_phone, '')), ''),
    'pending', coalesce(nullif(btrim(p_timezone), ''), 'America/New_York'),
    coalesce(p_currency, 'USD'),
    'trialing', now() + make_interval(days => greatest(0, coalesce(p_trial_days, 14)))
  )
  returning * into v_tenant;

  update public.tenant_settings
     set tech_fee_enabled = true,
         tech_fee_cents = 100,
         estimated_prep_time_mins = 20,
         accepts_delivery = true,
         accepts_pickup = true,
         default_tip_bps = 1500
   where tenant_id = v_tenant.id;

  insert into public.webhook_events (tenant_id, event_type, payload)
  values (
    v_tenant.id, 'tenant.provisioned',
    jsonb_build_object(
      'tenantId', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name,
      'supportEmail', v_tenant.support_email, 'trialEndsAt', v_tenant.trial_ends_at
    )
  );

  return v_tenant;
end;
$$;

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
  if not public.is_platform_operator() then
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
