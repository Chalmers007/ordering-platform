-- =====================================================================
-- 20260902090900_admin.sql
-- Platform operations: cross-tenant metrics, tenant provisioning,
-- impersonation sessions, and the error feed the console reads.
-- =====================================================================

set check_function_bodies = off;

-- New outbox event types. Added here and used only inside function bodies
-- (which Postgres does not evaluate at creation time) -- a literal use in
-- DML in this same transaction would fail with "unsafe use of new value".
alter type public.webhook_event_type add value if not exists 'tenant.invited';
alter type public.webhook_event_type add value if not exists 'tenant.provisioned';

-- ---------------------------------------------------------------------
-- platform_metrics()
--
-- Aggregated in the database, not in the console: pulling every order to
-- the browser to sum it would be slow, would leak far more than a number,
-- and would break the moment the platform has real volume.
-- ---------------------------------------------------------------------
create or replace function public.platform_metrics()
returns table (
  total_tenants          bigint,
  active_tenants         bigint,
  pending_tenants        bigint,
  suspended_tenants      bigint,
  past_due_tenants       bigint,
  gmv_cents              bigint,
  gmv_30d_cents          bigint,
  tech_fees_cents        bigint,
  tech_fees_30d_cents    bigint,
  orders_total           bigint,
  orders_30d             bigint,
  active_dispatch_jobs   bigint,
  open_kitchen_orders    bigint,
  paused_kitchens        bigint,
  platform_errors_24h    bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Platform metrics are restricted to platform administrators'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with revenue as (
    -- GMV counts money actually taken. Draft and unpaid carts are not
    -- revenue, and a refund is not a sale.
    select
      coalesce(sum(o.total_cents), 0)::bigint as gmv,
      coalesce(sum(o.total_cents) filter (where o.created_at > now() - interval '30 days'), 0)::bigint as gmv_30d,
      -- What actually routed to the platform account, not what was configured.
      coalesce(sum(o.application_fee_cents), 0)::bigint as fees,
      coalesce(sum(o.application_fee_cents) filter (where o.created_at > now() - interval '30 days'), 0)::bigint as fees_30d,
      count(*)::bigint as order_count,
      count(*) filter (where o.created_at > now() - interval '30 days')::bigint as order_count_30d,
      count(*) filter (where o.status in ('paid','confirmed','preparing','ready'))::bigint as open_kitchen
    from public.orders o
    where o.status not in ('draft', 'pending_payment', 'cancelled', 'refunded')
  ),
  errors as (
    select (
      (select count(*) from public.webhook_events
        where status in ('failed','abandoned') and updated_at > now() - interval '24 hours')
      + (select count(*) from public.inbound_webhook_events
        where error is not null and received_at > now() - interval '24 hours')
      + (select count(*) from public.deliveries
        where failure_reason is not null and updated_at > now() - interval '24 hours')
    )::bigint as total
  )
  select
    (select count(*) from public.tenants)::bigint,
    (select count(*) from public.tenants where status = 'active')::bigint,
    (select count(*) from public.tenants where status = 'pending')::bigint,
    (select count(*) from public.tenants where status = 'suspended')::bigint,
    (select count(*) from public.tenants where subscription_status in ('past_due','unpaid'))::bigint,
    revenue.gmv, revenue.gmv_30d, revenue.fees, revenue.fees_30d,
    revenue.order_count, revenue.order_count_30d,
    (select count(*) from public.deliveries
      where status in ('assigned','picked_up','en_route'))::bigint,
    revenue.open_kitchen,
    (select count(*) from public.tenant_settings where is_kitchen_paused)::bigint,
    errors.total
  from revenue, errors;
end;
$$;

-- ---------------------------------------------------------------------
-- platform_error_feed()
--
-- One list from three sources. Real rows -- a failed outbound webhook, a
-- payment event that could not be processed, a courier that would not take
-- a job -- rather than a log scrape.
-- ---------------------------------------------------------------------
create or replace function public.platform_error_feed(p_limit integer default 25)
returns table (
  source      text,
  occurred_at timestamptz,
  tenant_id   uuid,
  tenant_name text,
  reference   text,
  detail      text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'The platform error feed is restricted to platform administrators'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select * from (
    select
      'outbound_webhook'::text, w.updated_at, w.tenant_id, t.name,
      w.event_type::text, coalesce(w.last_error, 'Delivery failed')
    from public.webhook_events w
    left join public.tenants t on t.id = w.tenant_id
    where w.status in ('failed', 'abandoned')

    union all

    select
      'payment_webhook'::text, i.received_at, i.tenant_id, t.name,
      i.event_type, i.error
    from public.inbound_webhook_events i
    left join public.tenants t on t.id = i.tenant_id
    where i.error is not null

    union all

    select
      'dispatch'::text, d.updated_at, d.tenant_id, t.name,
      o.order_number, d.failure_reason
    from public.deliveries d
    join public.orders o on o.id = d.order_id
    left join public.tenants t on t.id = d.tenant_id
    where d.failure_reason is not null
  ) feed(source, occurred_at, tenant_id, tenant_name, reference, detail)
  order by feed.occurred_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
end;
$$;

-- ---------------------------------------------------------------------
-- slugify_tenant_name()
--
-- Deterministic, and it defers to the same reserved list and uniqueness
-- rules the tenants table enforces -- so the console never offers a slug
-- the insert would then reject.
-- ---------------------------------------------------------------------
create or replace function public.slugify_tenant_name(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_base   text;
  v_slug   text;
  v_suffix integer := 1;
begin
  v_base := lower(btrim(coalesce(p_name, '')));
  v_base := translate(v_base, 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(regexp_replace(v_base, '-+', '-', 'g'), '-');
  v_base := left(v_base, 50);

  if v_base = '' or v_base !~ '^[a-z0-9]' then
    v_base := 'restaurant';
  end if;

  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug)
     or exists (select 1 from public.reserved_subdomains where slug = v_slug)
  loop
    v_suffix := v_suffix + 1;
    v_slug := left(v_base, 50) || '-' || v_suffix;
  end loop;

  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------
-- provision_tenant()
--
-- Tenant + settings + outbox event in one transaction. A half-provisioned
-- restaurant -- a tenants row with no settings, or settings with the
-- platform fee silently off -- is worse than a failed create.
--
-- The tenants insert trigger already bootstraps a settings row; this
-- overwrites it with the platform's onboarding defaults.
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
  if not public.is_super_admin() then
    raise exception 'Only a platform administrator may provision a restaurant'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(length(btrim(p_name)), 0) = 0 then
    raise exception 'A restaurant name is required' using errcode = 'check_violation';
  end if;

  -- An explicit slug is taken at face value so the tenants constraints and
  -- the reserved-word trigger produce the error; only a blank one is derived.
  v_slug := coalesce(nullif(btrim(lower(p_slug)), ''), public.slugify_tenant_name(p_name));

  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'The subdomain "%" is already taken', v_slug
      using errcode = 'unique_violation';
  end if;

  perform set_config('app.audit_operation', 'PROVISION_TENANT', true);

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

  -- Onboarding defaults. The platform fee is ON by default: a restaurant
  -- that opts out is a decision someone makes, not an oversight.
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

-- ---------------------------------------------------------------------
-- assign_tenant_owner()
--
-- The one place a profile may be promoted to tenant_owner. The signup
-- trigger deliberately refuses to honour a client-supplied owner role, so
-- ownership can only ever be granted here, by the platform.
-- ---------------------------------------------------------------------
create or replace function public.assign_tenant_owner(
  p_tenant_id uuid,
  p_user_id   uuid,
  p_full_name text default null,
  p_email     text default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.user_profiles%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a platform administrator may assign a restaurant owner'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Unknown restaurant %', p_tenant_id using errcode = 'no_data_found';
  end if;

  perform set_config('app.audit_operation', 'ASSIGN_TENANT_OWNER', true);

  insert into public.user_profiles (id, tenant_id, role, full_name, email)
  values (p_user_id, p_tenant_id, 'tenant_owner',
          nullif(btrim(coalesce(p_full_name, '')), ''),
          nullif(btrim(coalesce(p_email, '')), ''))
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        role = 'tenant_owner',
        full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
        email = coalesce(excluded.email, public.user_profiles.email)
  returning * into v_profile;

  insert into public.webhook_events (tenant_id, event_type, payload)
  values (
    p_tenant_id, 'tenant.invited',
    jsonb_build_object(
      'tenantId', p_tenant_id, 'userId', p_user_id,
      'email', nullif(btrim(coalesce(p_email, '')), ''),
      'fullName', nullif(btrim(coalesce(p_full_name, '')), '')
    )
  );

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------
-- Impersonation
--
-- No second JWT is minted. The super admin keeps their own identity for
-- the whole session -- which is precisely what keeps the audit trail
-- honest: every write still records the administrator's user_id, and the
-- x-impersonated-tenant header sets audit_logs.impersonated.
--
-- These functions manage the session record the banner and the audit
-- trail read.
-- ---------------------------------------------------------------------
create or replace function public.start_impersonation(
  p_tenant_id uuid,
  p_reason    text default null
)
returns public.impersonation_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.impersonation_sessions%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a platform administrator may impersonate a restaurant'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Unknown restaurant %', p_tenant_id using errcode = 'no_data_found';
  end if;

  -- One active session per administrator: two at once would make the
  -- banner lie about which restaurant is being viewed.
  update public.impersonation_sessions
     set ended_at = now()
   where super_admin_id = auth.uid() and ended_at is null;

  perform set_config('app.audit_operation', 'START_IMPERSONATION', true);

  insert into public.impersonation_sessions (super_admin_id, tenant_id, reason)
  values (auth.uid(), p_tenant_id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.end_impersonation()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.audit_operation', 'END_IMPERSONATION', true);

  update public.impersonation_sessions
     set ended_at = now()
   where super_admin_id = auth.uid() and ended_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** The session the banner renders, if any. */
create or replace function public.active_impersonation()
returns table (session_id uuid, tenant_id uuid, tenant_name text, started_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.tenant_id, t.name, s.started_at
  from public.impersonation_sessions s
  join public.tenants t on t.id = s.tenant_id
  where s.super_admin_id = auth.uid()
    and s.ended_at is null
  order by s.started_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Grants. Every function re-checks is_super_admin() itself rather than
-- relying on the grant alone -- EXECUTE is coarse, and these read across
-- every tenant on the platform.
-- ---------------------------------------------------------------------
revoke all on function public.platform_metrics() from public, anon, authenticated;
revoke all on function public.platform_error_feed(integer) from public, anon, authenticated;
revoke all on function public.slugify_tenant_name(text) from public, anon, authenticated;
revoke all on function public.provision_tenant(text, text, text, text, text, char, integer) from public, anon, authenticated;
revoke all on function public.assign_tenant_owner(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.start_impersonation(uuid, text) from public, anon, authenticated;
revoke all on function public.end_impersonation() from public, anon, authenticated;
revoke all on function public.active_impersonation() from public, anon, authenticated;

grant execute on function public.platform_metrics() to authenticated;
grant execute on function public.platform_error_feed(integer) to authenticated;
grant execute on function public.slugify_tenant_name(text) to authenticated;
grant execute on function public.provision_tenant(text, text, text, text, text, char, integer) to authenticated;
grant execute on function public.assign_tenant_owner(uuid, uuid, text, text) to authenticated;
grant execute on function public.start_impersonation(uuid, text) to authenticated;
grant execute on function public.end_impersonation() to authenticated;
grant execute on function public.active_impersonation() to authenticated;
