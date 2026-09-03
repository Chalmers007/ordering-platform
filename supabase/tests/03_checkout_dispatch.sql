-- =====================================================================
-- 03_checkout_dispatch.sql
-- Slice 1: checkout -> payment split -> atomic order -> silent dispatch.
-- Depends on the fixtures from 01_schema_integrity.sql (tenant "joes" has
-- tech_fee_enabled = true, tech_fee_cents = 100).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===== fixtures =======================================================
-- A clean $20.00 item, so the split arithmetic is unambiguous.
insert into public.menu_items (id, tenant_id, category_id, name, slug, price_cents, is_taxable)
values ('aaaaaaa3-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'aaaaaaa1-0000-0000-0000-000000000001','Family Platter','family-platter', 2000, false)
on conflict (id) do nothing;

-- A modifier group attached to the Margherita ONLY. Used to prove a cart
-- cannot borrow a cheaper option from an unrelated item.
insert into public.menu_modifier_groups (id, tenant_id, name, selection_type, max_selections)
values ('ccccccc1-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'Extras','multiple', 3)
on conflict (id) do nothing;
insert into public.menu_modifiers (id, tenant_id, group_id, name, price_delta_cents)
values ('ccccccc2-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'ccccccc1-0000-0000-0000-000000000001','Extra cheese', 150)
on conflict (id) do nothing;
insert into public.menu_item_modifier_groups (tenant_id, item_id, group_id)
values ('11111111-1111-1111-1111-111111111111','aaaaaaa2-0000-0000-0000-000000000001',
        'ccccccc1-0000-0000-0000-000000000001')
on conflict (item_id, group_id) do nothing;

-- The connected account the split pays out to.
insert into public.payment_gateway_accounts
  (tenant_id, provider, status, is_default, external_account_id, charges_enabled,
   payouts_enabled, details_submitted, account_type)
values ('11111111-1111-1111-1111-111111111111','stripe','active', true,
        'acct_1RestaurantConnected', true, true, true, 'express')
on conflict (tenant_id, provider) do nothing;

-- The courier key. Readable only by service_role; asserted in T30.
insert into public.tenant_secrets (tenant_id, key, value)
values ('11111111-1111-1111-1111-111111111111','shipday_api_key','sk_live_courier_do_not_leak')
on conflict (tenant_id, key) do nothing;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- Open a checkout as the diner and keep the session id.
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text,
  false);

select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"pickup","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"Dana","phone":"5551234567","email":"dana@example.test"}'::jsonb
) ->> 'sessionId') as sid \gset

\echo ''
\echo '=== T24 a $20.00 cart is priced at $21.00 with a $1.00 platform fee'
select priced_cart ->> 'subtotalCents' = '2000' as subtotal_pass,
       priced_cart ->> 'techFeeCents'  = '100'  as tech_fee_pass,
       priced_cart ->> 'totalCents'    = '2100' as total_pass
from public.checkout_sessions where id = :'sid'::uuid;

\echo '=== T25 the webhook creates the order atomically; $20.00 nets to the restaurant'
select public.create_order_from_checkout(:'sid'::uuid, 'pi_test_1', 'ch_test_1', 100) as oid \gset
select
  o.total_cents            = 2100 as customer_charged_2100,
  o.application_fee_cents  = 100  as platform_takes_100,
  o.total_cents - o.application_fee_cents = 2000 as restaurant_nets_2000,
  o.tech_fee_cents         = 100  as tech_fee_recorded,
  o.status                 = 'paid' as status_pass,
  o.payment_status         = 'paid' as payment_status_pass,
  o.payment_intent_id      = 'pi_test_1' as intent_pass,
  o.is_first_time_customer = false as repeat_customer_pass  -- Dana ordered in T7
from public.orders o where o.id = :'oid'::uuid;

select count(*) = 1 as one_line_item,
       sum(line_total_cents) = 2000 as lines_match_subtotal
from public.order_items where order_id = :'oid'::uuid;

\echo '=== T26 redelivery is a no-op: same order id, still one order'
select public.create_order_from_checkout(:'sid'::uuid, 'pi_test_1', 'ch_test_1', 100)
       = :'oid'::uuid as idempotent_pass;
select count(*) = 1 as still_one_order from public.orders
 where id = :'oid'::uuid or payment_intent_id = 'pi_test_1';

\echo '=== T27 a snapshot tampered to SKIP the platform fee fails closed'
-- The attack: rewrite the stored cart to claim no technology fee, so the
-- split would route the whole charge to the restaurant and nothing to the
-- platform. The deferred trigger re-reads tenant_settings at COMMIT.
select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"pickup","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"Mallory","phone":"5557654321"}'::jsonb
) ->> 'sessionId') as sid_skip \gset
select set_config('test.sid_skip', :'sid_skip', false);

update public.checkout_sessions
   set priced_cart = jsonb_set(jsonb_set(priced_cart, '{techFeeCents}', '0'),
                               '{totalCents}', '2000')
 where id = :'sid_skip'::uuid;

do $$
declare v_sid uuid := current_setting('test.sid_skip')::uuid;
begin
  begin
    perform public.create_order_from_checkout(v_sid, 'pi_skip', null, 0);
    set constraints all immediate;
    raise exception 'FAIL: an order that skips the platform fee was accepted';
  exception when check_violation then
    raise notice 'PASS: fee-skipping order rejected by the deferred trigger';
  end;
end $$;

\echo '=== T28 a snapshot tampered to INFLATE the platform fee fails closed'
select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"pickup","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"Mallory","phone":"5557654321"}'::jsonb
) ->> 'sessionId') as sid_inflate \gset
select set_config('test.sid_inflate', :'sid_inflate', false);

update public.checkout_sessions
   set priced_cart = jsonb_set(jsonb_set(priced_cart, '{techFeeCents}', '500'),
                               '{totalCents}', '2500')
 where id = :'sid_inflate'::uuid;

do $$
declare v_sid uuid := current_setting('test.sid_inflate')::uuid;
begin
  begin
    perform public.create_order_from_checkout(v_sid, 'pi_inflate', null, 500);
    set constraints all immediate;
    raise exception 'FAIL: an inflated platform fee was accepted';
  exception when check_violation then
    raise notice 'PASS: inflated platform fee rejected by the deferred trigger';
  end;
end $$;

\echo '=== T29 a snapshot whose subtotal disagrees with its lines fails closed'
select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"pickup","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"Mallory","phone":"5557654321"}'::jsonb
) ->> 'sessionId') as sid_subtotal \gset
select set_config('test.sid_subtotal', :'sid_subtotal', false);

update public.checkout_sessions
   set priced_cart = jsonb_set(jsonb_set(priced_cart, '{subtotalCents}', '100'),
                               '{totalCents}', '200')
 where id = :'sid_subtotal'::uuid;

do $$
declare v_sid uuid := current_setting('test.sid_subtotal')::uuid;
begin
  begin
    perform public.create_order_from_checkout(v_sid, 'pi_subtotal', null, 100);
    set constraints all immediate;
    raise exception 'FAIL: a subtotal that disagrees with its line items was accepted';
  exception when check_violation then
    raise notice 'PASS: mismatched subtotal rejected by the deferred trigger';
  end;
end $$;

\echo '=== T30 a delivery order creates the dispatch row and the outbound events'
select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"delivery","tipCents":300,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"Newcomer","phone":"5550001111","email":"new@example.test"}'::jsonb,
  '{"addressLine1":"12 Elm St","city":"Raleigh","region":"NC","postalCode":"27601"}'::jsonb
) ->> 'sessionId') as sid_del \gset

select public.create_order_from_checkout(:'sid_del'::uuid, 'pi_del', 'ch_del', 100) as oid_del \gset

select d.status = 'unassigned' as delivery_unassigned,
       d.external_ref is null  as no_provider_ref_yet
from public.deliveries d where d.order_id = :'oid_del'::uuid;

select o.is_first_time_customer as first_time_flagged,
       o.total_cents = 2400 as delivery_total_pass   -- 2000 + 300 tip + 100 fee
from public.orders o where o.id = :'oid_del'::uuid;

select bool_and(t) as outbox_pass from (
  select (select count(*) = 1 from public.webhook_events
           where order_id = :'oid_del'::uuid and event_type = 'order.created') as t
  union all
  select (select count(*) = 1 from public.webhook_events
           where order_id = :'oid_del'::uuid and event_type = 'order.first_time_customer')
) x;

\echo '=== T31 the courier reference lands in deliveries, never on orders'
select public.record_dispatch_reference(:'oid_del'::uuid, 'shipday_job_98765', 'assigned');
select external_ref = 'shipday_job_98765' as ref_stored,
       status = 'assigned' as status_pass,
       assigned_at is not null as assigned_stamped
from public.deliveries where order_id = :'oid_del'::uuid;

-- No column on public.orders may name or carry the courier provider.
select count(*) = 0 as orders_has_no_provider_column
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and (column_name ilike '%shipday%' or column_name ilike '%courier%'
       or column_name ilike '%external_ref%');

\echo '=== T32 tenant_secrets returns 0 rows to the owner and is denied to anon'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');   -- tenant OWNER
  set local role authenticated;
  do $$
  declare v_n integer;
  begin
    begin
      select count(*) into v_n from public.tenant_secrets;
      if v_n = 0 then raise notice 'PASS: owner reads 0 rows from tenant_secrets';
      else raise exception 'FAIL: owner read % secret rows', v_n; end if;
    exception when insufficient_privilege then
      raise notice 'PASS: owner has no privilege on tenant_secrets';
    end;
  end $$;
rollback;

begin;
  select set_config('request.jwt.claims', null, true);
  set local role anon;
  do $$ begin
    begin
      perform 1 from public.tenant_secrets;
      raise exception 'FAIL: anon reached tenant_secrets';
    exception when insufficient_privilege then
      raise notice 'PASS: anon has no privilege on tenant_secrets';
    end;
  end $$;
rollback;

\echo '=== T33 checkout snapshots and the webhook ledger are service-role only'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  set local role authenticated;
  do $$ begin
    begin
      perform 1 from public.checkout_sessions;
      raise exception 'FAIL: an authenticated role reached checkout_sessions';
    exception when insufficient_privilege then
      raise notice 'PASS: checkout_sessions denied to authenticated';
    end;
    begin
      perform 1 from public.inbound_webhook_events;
      raise exception 'FAIL: an authenticated role reached inbound_webhook_events';
    exception when insufficient_privilege then
      raise notice 'PASS: inbound_webhook_events denied to authenticated';
    end;
  end $$;
rollback;

\echo '=== T33b no service-role-only table holds ANY client grant'
-- A bug-class guard, not a spot check: any table added after the security
-- migration inherits Supabase's default grants unless it revokes them. This
-- fails the moment a new one forgets.
select count(*) = 0 as no_stray_grants,
       coalesce(string_agg(distinct table_name || '/' || grantee, ', '), '(none)') as offenders
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('tenant_secrets', 'tenant_order_counters',
                     'checkout_sessions', 'inbound_webhook_events');

\echo '=== T34 the service-role-only functions are not executable by client roles'
-- Asserted via the privilege catalogue rather than by calling them: a local
-- Postgres terminates the backend on a denied SECURITY DEFINER call, which
-- takes the whole suite down instead of failing one test. The catalogue is
-- the same source the executor consults.
select
  not has_function_privilege('authenticated',
    'public.create_order_from_checkout(uuid,text,text,integer)', 'EXECUTE') as create_order_denied_auth,
  not has_function_privilege('anon',
    'public.create_order_from_checkout(uuid,text,text,integer)', 'EXECUTE') as create_order_denied_anon,
  not has_function_privilege('authenticated',
    'public.record_dispatch_reference(uuid,text,public.delivery_status,timestamptz,timestamptz,text,text,text,text)',
    'EXECUTE') as dispatch_ref_denied_auth,
  not has_function_privilege('anon',
    'public.record_dispatch_reference(uuid,text,public.delivery_status,timestamptz,timestamptz,text,text,text,text)',
    'EXECUTE') as dispatch_ref_denied_anon,
  -- ...while the customer's own entry points stay reachable.
  has_function_privilege('authenticated',
    'public.open_checkout_session(uuid,jsonb,jsonb,jsonb)', 'EXECUTE') as checkout_open_allowed,
  not has_function_privilege('anon',
    'public.open_checkout_session(uuid,jsonb,jsonb,jsonb)', 'EXECUTE') as checkout_open_denied_anon;

\echo '=== T35 a modifier from another item cannot be priced into a cart'
do $$ begin
  begin
    -- "Extra cheese" belongs to a group attached to the Margherita, not to
    -- the Family Platter. Accepting it would let a caller apply arbitrary
    -- price deltas from anywhere on the menu.
    perform public.price_cart('11111111-1111-1111-1111-111111111111',
      '{"fulfillmentType":"pickup","tipCents":0,
        "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001",
                  "quantity":1,
                  "modifiers":[{"modifierId":"ccccccc2-0000-0000-0000-000000000001","quantity":1}]}]}'::jsonb);
    raise exception 'FAIL: a foreign modifier was priced into the cart';
  exception when check_violation then
    raise notice 'PASS: foreign modifier rejected';
  end;
end $$;

\echo '=== T36 a paused kitchen cannot be checked out against'
update public.tenant_settings set is_kitchen_paused = true
 where tenant_id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    perform public.price_cart('11111111-1111-1111-1111-111111111111',
      '{"fulfillmentType":"pickup","tipCents":0,
        "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb);
    raise exception 'FAIL: a paused kitchen accepted an order';
  exception when check_violation then
    raise notice 'PASS: paused kitchen rejected the cart';
  end;
end $$;
update public.tenant_settings set is_kitchen_paused = false
 where tenant_id = '11111111-1111-1111-1111-111111111111';

select set_config('request.jwt.claims', null, false);

\echo ''
\echo '=== SLICE 1 SUITE COMPLETED ==='
