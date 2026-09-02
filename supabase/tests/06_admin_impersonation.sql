-- =====================================================================
-- 06_admin_impersonation.sql
-- Slice 4: platform console access, tenant provisioning, impersonation
-- audit integrity, and cross-tenant audit visibility.
-- Depends on fixtures from suites 01 and 03.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

\echo ''
\echo '=== T63 platform functions are refused to every non-super-admin'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');   -- tenant OWNER
  set local role authenticated;
  do $$ begin
    begin
      perform public.platform_metrics();
      raise exception 'FAIL: a tenant owner read platform metrics';
    exception when insufficient_privilege then raise notice 'PASS: metrics refused to a tenant owner';
    end;
    begin
      perform public.platform_error_feed(10);
      raise exception 'FAIL: a tenant owner read the platform error feed';
    exception when insufficient_privilege then raise notice 'PASS: error feed refused to a tenant owner';
    end;
    begin
      perform public.provision_tenant('Sneaky Diner');
      raise exception 'FAIL: a tenant owner provisioned a restaurant';
    exception when insufficient_privilege then raise notice 'PASS: provisioning refused to a tenant owner';
    end;
    begin
      perform public.start_impersonation('22222222-2222-2222-2222-222222222222');
      raise exception 'FAIL: a tenant owner impersonated another restaurant';
    exception when insufficient_privilege then raise notice 'PASS: impersonation refused to a tenant owner';
    end;
  end $$;
rollback;

begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');   -- a CUSTOMER
  set local role authenticated;
  do $$ begin
    begin
      perform public.platform_metrics();
      raise exception 'FAIL: a customer read platform metrics';
    exception when insufficient_privilege then raise notice 'PASS: metrics refused to a customer';
    end;
  end $$;
rollback;

\echo '=== T64 the super admin can read platform metrics across every tenant'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select total_tenants >= 2 as sees_all_tenants,
         gmv_cents > 0 as gmv_computed,
         tech_fees_cents > 0 as fees_computed,
         orders_total > 0 as orders_counted
  from public.platform_metrics();
commit;

\echo '=== T65 provisioning seeds the platform defaults'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select (public.provision_tenant('Bella Trattoria')).slug = 'bella-trattoria' as slug_derived;
commit;

select
  t.status = 'pending' as starts_pending,
  t.subscription_status = 'trialing' as starts_trialing,
  t.trial_ends_at > now() as trial_running,
  s.tech_fee_enabled as tech_fee_on_by_default,
  s.tech_fee_cents = 100 as tech_fee_is_one_dollar,
  s.estimated_prep_time_mins = 20 as default_prep_time,
  s.accepts_delivery and s.accepts_pickup as both_fulfilments
from public.tenants t
join public.tenant_settings s on s.tenant_id = t.id
where t.slug = 'bella-trattoria';

\echo '=== T66 provisioning enqueued the onboarding webhook'
select count(*) = 1 as provisioned_event_queued
from public.webhook_events w
join public.tenants t on t.id = w.tenant_id
where t.slug = 'bella-trattoria' and w.event_type = 'tenant.provisioned';

\echo '=== T67 subdomain uniqueness is enforced'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  do $$ begin
    begin
      perform public.provision_tenant('Anything', 'bella-trattoria');
      raise exception 'FAIL: a duplicate subdomain was accepted';
    exception when unique_violation then raise notice 'PASS: duplicate subdomain rejected';
    end;
    begin
      -- The reserved list is enforced by the tenants trigger, so it applies
      -- to provisioning too rather than being re-implemented here.
      perform public.provision_tenant('Admin Panel', 'admin');
      raise exception 'FAIL: a reserved subdomain was accepted';
    exception when check_violation then raise notice 'PASS: reserved subdomain rejected';
    end;
  end $$;
rollback;

\echo '=== T68 a derived slug avoids collisions instead of failing'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  -- Same name again: the slug must be suffixed, not collide.
  select (public.provision_tenant('Bella Trattoria')).slug = 'bella-trattoria-2' as suffixed;
  select public.slugify_tenant_name('  Café  Niño!! ') = 'cafe-nino' as accents_and_punctuation;
  select public.slugify_tenant_name('admin') <> 'admin' as reserved_word_avoided;
rollback;

\echo '=== T69 only the platform may grant tenant_owner'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  set local role authenticated;
  do $$ begin
    begin
      perform public.assign_tenant_owner(
        '11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-0000000000d1');
      raise exception 'FAIL: a tenant owner promoted someone to owner';
    exception when insufficient_privilege then
      raise notice 'PASS: only the platform may grant ownership';
    end;
  end $$;
rollback;

\echo '=== T70 impersonation records a session naming the admin AND the target'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select (public.start_impersonation('11111111-1111-1111-1111-111111111111', 'support call'))
           .tenant_id = '11111111-1111-1111-1111-111111111111' as targets_tenant;
  select super_admin_id = '00000000-0000-0000-0000-0000000000a1' as names_the_admin,
         ended_at is null as is_active
  from public.impersonation_sessions
  where super_admin_id = '00000000-0000-0000-0000-0000000000a1' and ended_at is null;
  select count(*) = 1 as banner_has_one_session
  from public.active_impersonation();
commit;

\echo '=== T71 starting a second impersonation closes the first'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select (public.start_impersonation('22222222-2222-2222-2222-222222222222'))
           .tenant_id = '22222222-2222-2222-2222-222222222222' as switched;
  -- Two at once would make the banner lie about which restaurant is in view.
  select count(*) = 1 as still_one_active
  from public.impersonation_sessions
  where super_admin_id = '00000000-0000-0000-0000-0000000000a1' and ended_at is null;
commit;

\echo '=== T72 a write made while impersonating is attributed to the SUPER ADMIN'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  -- PostgREST exposes request headers to the audit trigger; this is the
  -- header the middleware sets once it has verified the signed cookie.
  select set_config('request.headers',
    '{"x-impersonated-tenant":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select (public.set_kitchen_pause('11111111-1111-1111-1111-111111111111', true, 'Impersonated pause'))
           .is_kitchen_paused as paused_while_impersonating;
commit;

select
  user_id = '00000000-0000-0000-0000-0000000000a1' as attributed_to_the_admin,
  tenant_id = '11111111-1111-1111-1111-111111111111' as scoped_to_the_target_tenant,
  impersonated as flagged_as_impersonated,
  operation = 'TOGGLE_KITCHEN_PAUSE' as operation_recorded,
  (new_data ->> 'kitchen_paused_reason') = 'Impersonated pause' as change_captured
from public.audit_logs
where operation = 'TOGGLE_KITCHEN_PAUSE'
order by id desc limit 1;

-- The audit must never record the write as the tenant's own staff.
select count(*) = 0 as never_attributed_to_a_tenant_user
from public.audit_logs
where impersonated
  and user_id in (select id from public.user_profiles where role in ('tenant_owner','tenant_staff'));

begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select (public.set_kitchen_pause('11111111-1111-1111-1111-111111111111', false))
           .is_kitchen_paused = false as tidy_up;
  select public.end_impersonation() >= 1 as ended;
commit;

\echo '=== T73 ending impersonation leaves no active session'
select count(*) = 0 as no_active_sessions
from public.impersonation_sessions
where super_admin_id = '00000000-0000-0000-0000-0000000000a1' and ended_at is null;

\echo '=== T74 the super admin reads audit rows across EVERY tenant'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select count(distinct tenant_id) >= 2 as sees_multiple_tenants
  from public.audit_logs where tenant_id is not null;
commit;

\echo '=== T75 a tenant owner sees audit rows for their own tenant ONLY'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');   -- Joe's owner
  set local role authenticated;
  select count(*) > 0 as sees_own_rows,
         bool_and(tenant_id = '11111111-1111-1111-1111-111111111111') as only_own_tenant
  from public.audit_logs;
  -- Including the rows the super admin generated while impersonating them:
  -- visible, because they happened to this restaurant.
  select count(*) >= 1 as sees_the_impersonated_write
  from public.audit_logs
  where impersonated and tenant_id = '11111111-1111-1111-1111-111111111111';
commit;

\echo '=== T76 staff and customers cannot read the audit log at all'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');   -- staff
  set local role authenticated;
  select count(*) = 0 as staff_see_nothing from public.audit_logs;
commit;
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');   -- customer
  set local role authenticated;
  select count(*) = 0 as customers_see_nothing from public.audit_logs;
commit;

\echo '=== T77 a super admin is never bound to a tenant'
select count(*) = 0 as super_admins_have_no_tenant
from public.user_profiles where role = 'super_admin' and tenant_id is not null;

select set_config('request.jwt.claims', null, false);
select set_config('request.headers', null, false);

\echo ''
\echo '=== SLICE 4 SUITE COMPLETED ==='
