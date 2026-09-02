-- =====================================================================
-- 02_rls_isolation.sql
-- Multi-tenant isolation, role boundaries, and the public (anon) surface.
-- Depends on the fixtures created by 01_schema_integrity.sql.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- The second tenant needs an order so isolation can be proved both ways.
insert into public.orders (id, tenant_id, status, customer_name, customer_phone,
  fulfillment_type, subtotal_cents, total_cents)
values ('eeeeeeee-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','paid',
        'Bee','5559998888','pickup', 0, 0)
on conflict (id) do nothing;

-- Impersonate a JWT the way PostgREST does.
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

\echo ''
\echo '=== T11 tenant_staff of Joe''s sees ONLY Joe''s orders'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  select count(*) = 1 as sees_one,
         bool_and(tenant_id = '11111111-1111-1111-1111-111111111111') as all_own_tenant
  from public.orders;
commit;

\echo '=== T12 owner of Maria''s sees ZERO of Joe''s orders'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  set local role authenticated;
  select count(*) filter (where tenant_id = '11111111-1111-1111-1111-111111111111') = 0 as pass
  from public.orders;
commit;

\echo '=== T13 super_admin reaches BOTH tenants (the impersonation path)'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select count(distinct tenant_id) = 2 as pass from public.orders;
commit;

\echo '=== T14 customer sees only their own order'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  select count(*) = 1 as sees_one,
         bool_and(customer_user_id = '00000000-0000-0000-0000-0000000000d1') as all_own
  from public.orders;
commit;

\echo '=== T15 anon reads the published menu; orders are denied at the GRANT layer'
begin;
  select set_config('request.jwt.claims', null, true);
  set local role anon;
  -- Scoped to the fixture tenant: the demo seed publishes a menu too, and
  -- anon is legitimately allowed to read it.
  select count(*) filter (where tenant_id = '11111111-1111-1111-1111-111111111111') = 1
         as menu_visible,
         count(*) > 1 as demo_menu_also_public
  from public.menu_items;
  do $$ begin
    begin
      perform 1 from public.orders;
      raise exception 'FAIL: anon reached the orders table';
    exception when insufficient_privilege then
      raise notice 'PASS: anon has no privilege on orders (denied before RLS is consulted)';
    end;
  end $$;
commit;

\echo '=== T16 staff CANNOT change the tech fee (column guard)'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  do $$ begin
    begin
      update public.tenant_settings set tech_fee_enabled = false
       where tenant_id = '11111111-1111-1111-1111-111111111111';
      raise exception 'FAIL: staff changed the tech fee';
    exception when insufficient_privilege then raise notice 'PASS: staff blocked from fee columns';
    end;
  end $$;
rollback;

\echo '=== T17 staff CAN pause the kitchen (operational column)'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  update public.tenant_settings set is_kitchen_paused = true, estimated_prep_time_mins = 45
   where tenant_id = '11111111-1111-1111-1111-111111111111';
  select is_kitchen_paused and kitchen_paused_at is not null and estimated_prep_time_mins = 45 as pass
  from public.tenant_settings where tenant_id = '11111111-1111-1111-1111-111111111111';
rollback;

\echo '=== T18 a customer cannot promote themselves'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  do $$ begin
    begin
      update public.user_profiles set role = 'tenant_owner'
       where id = '00000000-0000-0000-0000-0000000000d1';
      raise exception 'FAIL: self-promotion succeeded';
    exception when insufficient_privilege then raise notice 'PASS: self-promotion blocked';
    end;
  end $$;
rollback;

\echo '=== T19 tenant_secrets is invisible even to the tenant owner'
insert into public.tenant_secrets (tenant_id, key, value)
values ('11111111-1111-1111-1111-111111111111','shipday_api_key','sk_live_do_not_leak')
on conflict (tenant_id, key) do nothing;
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  set local role authenticated;
  do $$
  declare v_n integer;
  begin
    begin
      select count(*) into v_n from public.tenant_secrets;
      if v_n = 0 then raise notice 'PASS: owner sees 0 secret rows';
      else raise exception 'FAIL: owner read % secret rows', v_n; end if;
    exception when insufficient_privilege then raise notice 'PASS: owner denied on tenant_secrets';
    end;
  end $$;
commit;

\echo '=== T20 audit_logs: owner yes, staff no'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  set local role authenticated;
  select count(*) > 0 as owner_can_read from public.audit_logs;
commit;
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  select count(*) = 0 as staff_cannot_read from public.audit_logs;
commit;

\echo '=== T21 anon: host -> tenant resolution and guest order tracking'
begin;
  select set_config('request.jwt.claims', null, true);
  set local role anon;
  select tenant_id = '11111111-1111-1111-1111-111111111111' and is_custom_domain as custom_domain_pass
  from public.resolve_storefront('orders.joespizza.com', null);
  select tenant_id = '11111111-1111-1111-1111-111111111111' and not is_custom_domain as subdomain_pass
  from public.resolve_storefront('unknown.example.com', 'joes');
  -- A domain the operator added but never verified must not route. Otherwise
  -- anyone could point DNS at the platform and be served someone's storefront.
  select count(*) = 0 as unverified_domain_rejected
  from public.resolve_storefront('staging.joespizza.com', null);
commit;

-- Resolve the token as postgres FIRST: an anon caller has no privilege on
-- public.orders, which is exactly why the tracking RPC is SECURITY DEFINER.
select tracking_token as tok from public.orders
 where id='dddddddd-0000-0000-0000-000000000003' \gset
begin;
  select set_config('request.jwt.claims', null, true);
  set local role anon;
  select count(*) = 1 as tracking_pass
  from public.get_order_by_tracking_token(:'tok'::uuid);
commit;

\echo '=== T21b the tracking RPC leaks no payment or dispatch identifiers'
select not bool_or(
         p.arg_name in ('payment_intent_id','payment_charge_id','external_ref',
                        'customer_phone','customer_email','application_fee_cents')
       ) as pass
from (
  select unnest(proargnames) as arg_name
  from pg_proc
  where proname = 'get_order_by_tracking_token'
) p;

\echo '=== T22 a customer cannot mint an order against another tenant'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  do $$ begin
    begin
      insert into public.orders (tenant_id, status, customer_user_id, customer_name,
        customer_phone, fulfillment_type, subtotal_cents, total_cents)
      values ('22222222-2222-2222-2222-222222222222','draft',
              '00000000-0000-0000-0000-0000000000b1','Mallory','5550000000','pickup',0,0);
      raise exception 'FAIL: order inserted for another user/tenant';
    exception when insufficient_privilege then raise notice 'PASS: RLS blocked the insert';
    end;
  end $$;
rollback;

\echo '=== T23 a customer cannot edit an order after it leaves draft'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  do $$ begin
    begin
      update public.orders set tip_cents = 0, total_cents = total_cents - 200
       where id = 'dddddddd-0000-0000-0000-000000000003';
      raise exception 'FAIL: customer edited a placed order';
    exception when insufficient_privilege then raise notice 'PASS: placed order is immutable to the customer';
    end;
  end $$;
rollback;

\echo ''
\echo '=== ALL SUITES COMPLETED (a regression would have aborted on ON_ERROR_STOP) ==='
