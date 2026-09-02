-- =====================================================================
-- 07_e2e_journey.sql
-- End-to-end: one order through all four slices, against the DEMO tenant
-- seeded by supabase/seed.sql -- not against synthetic fixtures.
--
--   Slice 4  platform console + impersonation
--   Slice 2  storefront cart -> server-priced snapshot
--   Slice 1  checkout -> fee split -> atomic order -> dispatch row
--   Slice 3  KDS state machine + pacing audit
--   Slice 2  white-labelled tracking payload
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\set TENANT '0a11ce00-0000-4000-8000-000000000001'
\set MARGHERITA '0a11ce00-0004-4000-8000-000000000001'
\set SIZE_14 '0a11ce00-0003-4000-8000-000000000002'
\set CRUST_CLASSIC '0a11ce00-0003-4000-8000-000000000004'
\set PEPPERONI '0a11ce00-0003-4000-8000-000000000008'

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
end $$;

-- The suite creates its own accounts rather than depending on
-- scripts/seed-demo.ts: the runner resets the database first, which drops
-- every auth user, so a suite that looked them up by email would be
-- testing whether the seeder happened to run last. The MENU it exercises
-- is the real seeded one from supabase/seed.sql, which the reset applies.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
values
  ('0a11ce00-0009-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','e2e-admin@platform.test','x',now(),now(),now(),'{}','{}', '', '', '', ''),
  ('0a11ce00-0009-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','e2e-kitchen@joespizza.test','x',now(),now(),now(),'{}','{}', '', '', '', ''),
  ('0a11ce00-0009-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','e2e-diner@joespizza.test','x',now(),now(),now(),'{}','{}', '', '', '', '')
on conflict (id) do nothing;

-- A super admin is platform-scoped and must carry no tenant_id.
update public.user_profiles set role = 'super_admin', tenant_id = null
 where id = '0a11ce00-0009-4000-8000-00000000000a';
update public.user_profiles set role = 'tenant_staff', tenant_id = :'TENANT'
 where id = '0a11ce00-0009-4000-8000-00000000000b';
update public.user_profiles set role = 'customer', tenant_id = :'TENANT'
 where id = '0a11ce00-0009-4000-8000-000000000001';

\set admin_id '0a11ce00-0009-4000-8000-00000000000a'
\set staff_id '0a11ce00-0009-4000-8000-00000000000b'

\echo ''
\echo '=== E2E-1  the platform console sees the demo restaurant'
select pg_temp.as_user(:'admin_id');
set role authenticated;
select active_tenants >= 1 as tenants_counted,
       paused_kitchens = 0 as kitchen_running
from public.platform_metrics();
reset role;

\echo '=== E2E-2  impersonation opens against the demo restaurant'
select pg_temp.as_user(:'admin_id');
set role authenticated;
select (public.start_impersonation(:'TENANT', 'end-to-end pass')).tenant_id = :'TENANT'
       as impersonating_demo_tenant;
select tenant_name = 'Joe''s Authentic Pizzeria' as banner_names_the_target
from public.active_impersonation();
reset role;

\echo '=== E2E-3  the server prices a real cart from the seeded menu'
-- 14" Margherita, classic crust, pepperoni, for delivery.
select public.price_cart(:'TENANT', json_build_object(
  'fulfillmentType','delivery',
  'tipCents', 0,
  'lines', json_build_array(json_build_object(
    'lineId','line-1',
    'menuItemId', :'MARGHERITA',
    'quantity', 1,
    'modifiers', json_build_array(
      json_build_object('modifierId', :'SIZE_14', 'quantity', 1),
      json_build_object('modifierId', :'CRUST_CLASSIC', 'quantity', 1),
      json_build_object('modifierId', :'PEPPERONI', 'quantity', 1))
  ))
)::jsonb) as priced \gset

select
  (:'priced'::jsonb ->> 'subtotalCents')    = '2000' as subtotal_1400_plus_600_options,
  (:'priced'::jsonb ->> 'deliveryFeeCents') = '499'  as delivery_fee_applied,
  (:'priced'::jsonb ->> 'taxCents')         = '175'  as tax_at_8_75_percent,
  (:'priced'::jsonb ->> 'techFeeCents')     = '100'  as platform_fee_one_dollar,
  (:'priced'::jsonb ->> 'totalCents')       = '2774' as total_balances;

\echo '=== E2E-4  a cart missing a required choice is refused'
do $$ begin
  begin
    -- Size and Crust are both required on this pizza.
    perform public.price_cart('0a11ce00-0000-4000-8000-000000000001', '{
      "fulfillmentType":"delivery","tipCents":0,
      "lines":[{"lineId":"l1","menuItemId":"0a11ce00-0004-4000-8000-000000000001","quantity":1}]}'::jsonb);
    raise exception 'FAIL: a pizza was priced with no size or crust';
  exception when check_violation then raise notice 'PASS: required options enforced on the real menu';
  end;
end $$;

\echo '=== E2E-5  a sold-out item cannot be ordered'
do $$ begin
  begin
    perform public.price_cart('0a11ce00-0000-4000-8000-000000000001', '{
      "fulfillmentType":"pickup","tipCents":0,
      "lines":[{"lineId":"l1","menuItemId":"0a11ce00-0004-4000-8000-000000000006","quantity":1}]}'::jsonb);
    raise exception 'FAIL: the sold-out Burrata was priced';
  exception when check_violation then raise notice 'PASS: sold-out item refused';
  end;
end $$;

\echo '=== E2E-6  checkout snapshots the cart and creates the order atomically'
select pg_temp.as_user('0a11ce00-0009-4000-8000-000000000001');
select (public.open_checkout_session(
  :'TENANT',
  json_build_object(
    'fulfillmentType','delivery','tipCents', 500,
    'lines', json_build_array(json_build_object(
      'lineId','line-1','menuItemId', :'MARGHERITA','quantity', 1,
      'modifiers', json_build_array(
        json_build_object('modifierId', :'SIZE_14','quantity',1),
        json_build_object('modifierId', :'CRUST_CLASSIC','quantity',1),
        json_build_object('modifierId', :'PEPPERONI','quantity',1))))
  )::jsonb,
  '{"name":"Ada Diner","phone":"9195550188","email":"diner@joespizza.test"}'::jsonb,
  '{"addressLine1":"400 Hillsborough St","city":"Raleigh","region":"NC","postalCode":"27603",
    "instructions":"Ring the bell"}'::jsonb
) ->> 'sessionId') as sid \gset
select set_config('request.jwt.claims', null, false);

select public.create_order_from_checkout(:'sid'::uuid, 'pi_e2e_demo', 'ch_e2e_demo', 100) as oid \gset
select set_config('test.oid', :'oid', false);

\echo '=== E2E-7  the $1.00 split: platform takes 100, the restaurant nets the rest'
select
  o.total_cents = 3274 as customer_charged_32_74,      -- 2000 + 175 tax + 500 tip + 499 delivery + 100 fee
  o.tech_fee_cents = 100 as tech_fee_recorded,
  o.application_fee_cents = 100 as platform_takes_one_dollar,
  o.total_cents - o.application_fee_cents = 3174 as restaurant_nets_31_74,
  o.status = 'paid' as order_is_paid,
  o.is_first_time_customer as first_time_flagged
from public.orders o where o.id = current_setting('test.oid')::uuid;

select count(*) = 1 as one_line_item,
       (select count(*) from public.order_item_modifiers m
         join public.order_items i on i.id = m.order_item_id
        where i.order_id = current_setting('test.oid')::uuid) = 3 as three_modifiers_snapshotted
from public.order_items where order_id = current_setting('test.oid')::uuid;

\echo '=== E2E-8  a dispatch row and the CRM outbox events were created'
select status = 'unassigned' as dispatch_queued, external_ref is null as no_courier_yet
from public.deliveries where order_id = current_setting('test.oid')::uuid;

select count(*) = 2 as order_created_and_first_time_queued
from public.webhook_events
where order_id = current_setting('test.oid')::uuid
  and event_type in ('order.created', 'order.first_time_customer');

\echo '=== E2E-9  the KDS walks the order across the board'
select pg_temp.as_user(:'staff_id');
set role authenticated;
select (public.advance_order_status(current_setting('test.oid')::uuid, 'preparing')).status = 'preparing' as to_preparing;
select (public.advance_order_status(current_setting('test.oid')::uuid, 'ready')).status = 'ready' as to_ready;
select (public.advance_order_status(current_setting('test.oid')::uuid, 'out_for_delivery')).status = 'out_for_delivery' as to_dispatch;
reset role;
select set_config('request.jwt.claims', null, false);

select count(*) = 4 as four_status_events   -- paid, preparing, ready, out_for_delivery
from public.order_status_events where order_id = current_setting('test.oid')::uuid;

select count(*) = 3 as three_audited_transitions
from public.audit_logs
where record_id = current_setting('test.oid')::uuid and operation = 'ADVANCE_ORDER_STATUS';

\echo '=== E2E-10 pausing the kitchen is audited and stops the storefront'
select pg_temp.as_user(:'staff_id');
set role authenticated;
select (public.set_kitchen_pause(:'TENANT', true, 'Oven repair')).is_kitchen_paused as paused;
reset role;
select set_config('request.jwt.claims', null, false);

select user_id = (select id from auth.users where email = 'e2e-kitchen@joespizza.test') as staff_attributed,
       operation = 'TOGGLE_KITCHEN_PAUSE' as operation_recorded,
       (new_data ->> 'kitchen_paused_reason') = 'Oven repair' as reason_captured
from public.audit_logs
where operation = 'TOGGLE_KITCHEN_PAUSE' and tenant_id = '0a11ce00-0000-4000-8000-000000000001'
order by id desc limit 1;

do $$ begin
  begin
    perform public.price_cart('0a11ce00-0000-4000-8000-000000000001', '{
      "fulfillmentType":"pickup","tipCents":0,
      "lines":[{"lineId":"l1","menuItemId":"0a11ce00-0004-4000-8000-000000000004","quantity":1}]}'::jsonb);
    raise exception 'FAIL: the storefront priced a cart while the kitchen was paused';
  exception when check_violation then raise notice 'PASS: pause reaches the storefront';
  end;
end $$;

select pg_temp.as_user(:'staff_id');
set role authenticated;
select (public.set_kitchen_pause(:'TENANT', false)).is_kitchen_paused = false as resumed;
reset role;
select set_config('request.jwt.claims', null, false);

\echo '=== E2E-11 the courier reference is recorded where customers cannot read it'
select public.record_dispatch_reference(
  current_setting('test.oid')::uuid, 'demo_courier_job_5150', 'en_route');

select external_ref = 'demo_courier_job_5150' as ref_on_deliveries
from public.deliveries where order_id = current_setting('test.oid')::uuid;

\echo '=== E2E-12 the tracking payload carries no vendor identifiers'
select pg_temp.as_user('0a11ce00-0009-4000-8000-000000000001');
set role authenticated;
select order_status = 'out_for_delivery' as customer_sees_status,
       delivery_status = 'en_route' as customer_sees_delivery,
       has_external_ref as internal_flag_only
from public.get_delivery_tracking(current_setting('test.oid')::uuid, null);
reset role;
select set_config('request.jwt.claims', null, false);

-- The function's own signature is the guarantee: there is no column here
-- that could carry the courier's job id or the tenant's key.
select not bool_or(arg_name in ('external_ref','provider','shipday_order_id',
                                'shipday_api_key','payment_intent_id')) as no_vendor_columns
from (select unnest(proargnames) as arg_name from pg_proc
      where proname = 'get_delivery_tracking') p;

\echo '=== E2E-13 the courier key stays invisible to every browser role'
begin;
  select set_config('request.jwt.claims', null, true);
  set local role anon;
  do $$ begin
    begin
      perform 1 from public.tenant_secrets;
      raise exception 'FAIL: anon reached the courier key';
    exception when insufficient_privilege then raise notice 'PASS: courier key unreachable by anon';
    end;
  end $$;
rollback;

\echo '=== E2E-14 impersonation ends cleanly'
select pg_temp.as_user(:'admin_id');
set role authenticated;
select public.end_impersonation() >= 1 as ended;
reset role;
select set_config('request.jwt.claims', null, false);

\echo ''
\echo '=== END-TO-END JOURNEY COMPLETED ==='
