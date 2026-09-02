-- =====================================================================
-- 04_storefront_tracking.sql
-- Slice 2: server-priced carts, customer-scoped reads, white-labelled
-- tracking, and the post-checkout account upsell.
-- Depends on fixtures from suites 01 and 03.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- A second diner on the SAME tenant, so isolation is tested between
-- customers rather than between tenants (which suite 02 already covers).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','other-diner@example.test','x',now(),now(),now(),'{}','{}', '', '', '', '')
on conflict (id) do nothing;
update public.user_profiles set role='customer', tenant_id='11111111-1111-1111-1111-111111111111'
 where id='00000000-0000-0000-0000-0000000000d2';

\echo ''
\echo '=== T37 price_cart IGNORES any price the client sends'
-- The cart wire format carries selections only. Even when a caller injects
-- price-shaped fields, the priced result comes from the menu.
select (public.price_cart('11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"pickup","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1,
              "unitPriceCents":1,"lineTotalCents":1,"price_cents":1,"totalCents":1}]}'::jsonb)
) as forged \gset
select
  (:'forged'::jsonb ->> 'subtotalCents') = '2000' as subtotal_from_db,
  (:'forged'::jsonb ->> 'totalCents')    = '2100' as total_from_db,
  ((:'forged'::jsonb -> 'lines' -> 0) ->> 'unitPriceCents') = '2000' as unit_price_from_db;

\echo '=== T38 a sold-out item cannot be priced into a cart'
update public.menu_items set is_available = false
 where id = 'aaaaaaa3-0000-0000-0000-000000000001';
do $$ begin
  begin
    perform public.price_cart('11111111-1111-1111-1111-111111111111',
      '{"fulfillmentType":"pickup","tipCents":0,
        "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb);
    raise exception 'FAIL: a sold-out item was priced';
  exception when check_violation then raise notice 'PASS: sold-out item rejected';
  end;
end $$;
update public.menu_items set is_available = true
 where id = 'aaaaaaa3-0000-0000-0000-000000000001';

\echo '=== T39 a required modifier group cannot be skipped'
-- "Extras" on the Margherita is optional; make it required and prove the
-- server enforces it independently of the browser.
update public.menu_modifier_groups
   set is_required = true, min_selections = 1
 where id = 'ccccccc1-0000-0000-0000-000000000001';
do $$ begin
  begin
    perform public.price_cart('11111111-1111-1111-1111-111111111111',
      '{"fulfillmentType":"pickup","tipCents":0,
        "lines":[{"lineId":"l1","menuItemId":"aaaaaaa2-0000-0000-0000-000000000001","quantity":1}]}'::jsonb);
    raise exception 'FAIL: a required modifier group was skipped';
  exception when check_violation then raise notice 'PASS: required group enforced';
  end;
end $$;

\echo '=== T40 exceeding a group maximum is rejected'
update public.menu_modifier_groups set max_selections = 1
 where id = 'ccccccc1-0000-0000-0000-000000000001';
insert into public.menu_modifiers (id, tenant_id, group_id, name, price_delta_cents)
values ('ccccccc2-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
        'ccccccc1-0000-0000-0000-000000000001','Extra basil', 50)
on conflict (id) do nothing;
do $$ begin
  begin
    perform public.price_cart('11111111-1111-1111-1111-111111111111',
      '{"fulfillmentType":"pickup","tipCents":0,
        "lines":[{"lineId":"l1","menuItemId":"aaaaaaa2-0000-0000-0000-000000000001","quantity":1,
                  "modifiers":[{"modifierId":"ccccccc2-0000-0000-0000-000000000001","quantity":1},
                               {"modifierId":"ccccccc2-0000-0000-0000-000000000002","quantity":1}]}]}'::jsonb);
    raise exception 'FAIL: more selections than the group allows were priced';
  exception when check_violation then raise notice 'PASS: group maximum enforced';
  end;
end $$;
update public.menu_modifier_groups set is_required = false, min_selections = 0, max_selections = 3
 where id = 'ccccccc1-0000-0000-0000-000000000001';

\echo '=== T41 a customer reads only their OWN orders and deliveries'
-- Give Dana a delivery order to own. open_checkout_session() reads
-- auth.uid(), so identify as Dana BEFORE opening it.
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text,
  false);
select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"delivery","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"Dana","phone":"5551234567"}'::jsonb,
  '{"addressLine1":"9 Oak Ave","city":"Raleigh","region":"NC","postalCode":"27601"}'::jsonb
) ->> 'sessionId') as sid_d \gset
select set_config('test.sid_d', :'sid_d', false);
select set_config('request.jwt.claims', null, false);
select public.create_order_from_checkout(:'sid_d'::uuid, 'pi_dana', 'ch_dana', 100) as oid_dana \gset
select set_config('test.oid_dana', :'oid_dana', false);

begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  select bool_and(customer_user_id = '00000000-0000-0000-0000-0000000000d1') as only_own_orders,
         count(*) >= 1 as sees_own
  from public.orders;
  -- The property is ownership, not a count: every delivery row visible to
  -- Dana must hang off an order that is hers. Asserting a literal count
  -- would only be testing how many fixtures the earlier suites happened to
  -- leave behind.
  select count(*) > 0 as sees_some_deliveries,
         bool_and(exists (
           select 1 from public.orders o
           where o.id = d.order_id
             and o.customer_user_id = '00000000-0000-0000-0000-0000000000d1'
         )) as every_delivery_is_hers
  from public.deliveries d;
commit;

\echo '=== T42 a DIFFERENT customer on the same tenant sees none of it'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  set local role authenticated;
  select count(*) = 0 as no_orders     from public.orders;
  select count(*) = 0 as no_deliveries from public.deliveries;
commit;

\echo '=== T43 tracking: the owner sees it, another customer does not'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  select count(*) = 1 as owner_can_track
  from public.get_delivery_tracking(current_setting('test.oid_dana')::uuid, null);
commit;
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  set local role authenticated;
  select count(*) = 0 as stranger_cannot_track
  from public.get_delivery_tracking(current_setting('test.oid_dana')::uuid, null);
commit;

\echo '=== T44 tracking by token works for a signed-out guest'
select tracking_token as tok from public.orders
 where id = current_setting('test.oid_dana')::uuid \gset
begin;
  select set_config('request.jwt.claims', null, true);
  set local role anon;
  select count(*) = 1 as token_holder_can_track
  from public.get_delivery_tracking(null, :'tok'::uuid);
  -- A guessed token resolves to nothing.
  select count(*) = 0 as wrong_token_rejected
  from public.get_delivery_tracking(null, '00000000-0000-0000-0000-0000000000ff'::uuid);
  -- And an order id alone is not enough without a session.
  select count(*) = 0 as anon_needs_the_token
  from public.get_delivery_tracking(current_setting('test.oid_dana')::uuid, null);
commit;

\echo '=== T45 the tracking function exposes no courier reference'
select not bool_or(arg_name in ('external_ref', 'provider', 'shipday_order_id',
                                'payment_intent_id', 'customer_phone')) as no_vendor_columns
from (select unnest(proargnames) as arg_name from pg_proc
      where proname = 'get_delivery_tracking') p;

\echo '=== T46 the account upsell grants exactly one reward, idempotently'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  select (public.complete_customer_account(
    '11111111-1111-1111-1111-111111111111', 'dana@example.test', 'Dana Q', true,
    current_setting('test.oid_dana')::uuid) ->> 'rewardGranted')::boolean as first_call_grants;
  select (public.complete_customer_account(
    '11111111-1111-1111-1111-111111111111', 'dana@example.test', 'Dana Q', true,
    current_setting('test.oid_dana')::uuid) ->> 'rewardGranted')::boolean = false as second_call_does_not;
  select count(*) = 1 as exactly_one_reward
  from public.customer_rewards
  where user_id = '00000000-0000-0000-0000-0000000000d1' and kind = 'account_signup';
  select amount_cents = 500 as reward_is_five_dollars
  from public.customer_rewards
  where user_id = '00000000-0000-0000-0000-0000000000d1' and kind = 'account_signup';
rollback;

\echo '=== T47 the upsell refuses an order that is not yours'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  set local role authenticated;
  do $$ begin
    begin
      perform public.complete_customer_account(
        '11111111-1111-1111-1111-111111111111', 'thief@example.test', 'Mallory', true,
        current_setting('test.oid_dana')::uuid);
      raise exception 'FAIL: another customer claimed a reward against a stranger''s order';
    exception when insufficient_privilege then
      raise notice 'PASS: reward refused against an order the caller does not own';
    end;
  end $$;
rollback;

\echo '=== T48 a customer sees only their own rewards'
insert into public.customer_rewards (tenant_id, user_id, kind, amount_cents)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000d1',
        'account_signup', 500)
on conflict do nothing;
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  set local role authenticated;
  select count(*) = 0 as stranger_sees_no_rewards from public.customer_rewards;
commit;

\echo '=== T49 checkout-session resolution is scoped to whoever opened it'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  select count(*) = 1 as owner_resolves
  from public.resolve_checkout_order(current_setting('test.sid_d')::uuid);
commit;
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  set local role authenticated;
  select count(*) = 0 as stranger_cannot_resolve
  from public.resolve_checkout_order(current_setting('test.sid_d')::uuid);
commit;

\echo ''
\echo '=== SLICE 2 SUITE COMPLETED ==='
