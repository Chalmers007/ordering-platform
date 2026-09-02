-- =====================================================================
-- 05_kds_audit.sql
-- Slice 3: validated KDS state transitions, kitchen pacing, and the
-- audit records both must leave behind.
-- Depends on fixtures from suites 01, 03 and 04.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- A fresh paid order to walk across the board.
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text,
  false);
select (public.open_checkout_session(
  '11111111-1111-1111-1111-111111111111',
  '{"fulfillmentType":"pickup","tipCents":0,
    "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb,
  '{"name":"KDS Test","phone":"5554443333"}'::jsonb
) ->> 'sessionId') as sid_kds \gset
select set_config('request.jwt.claims', null, false);
select public.create_order_from_checkout(:'sid_kds'::uuid, 'pi_kds', 'ch_kds', 100) as oid_kds \gset
select set_config('test.oid_kds', :'oid_kds', false);

\echo ''
\echo '=== T50 staff advance paid -> preparing -> ready'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');   -- tenant_staff
  set local role authenticated;
  select (public.advance_order_status(current_setting('test.oid_kds')::uuid, 'preparing')).status
         = 'preparing' as to_preparing;
  select (public.advance_order_status(current_setting('test.oid_kds')::uuid, 'ready')).status
         = 'ready' as to_ready;
commit;

\echo '=== T51 every transition appended an order_status_events row'
select
  count(*) filter (where to_status = 'paid')      = 1 as recorded_paid,
  count(*) filter (where to_status = 'preparing') = 1 as recorded_preparing,
  count(*) filter (where to_status = 'ready')     = 1 as recorded_ready,
  bool_and(tenant_id = '11111111-1111-1111-1111-111111111111') as tenant_scoped
from public.order_status_events
where order_id = current_setting('test.oid_kds')::uuid;

\echo '=== T52 the staff member who moved it is on the history and the audit'
select actor_id = '00000000-0000-0000-0000-0000000000b2' as actor_recorded
from public.order_status_events
where order_id = current_setting('test.oid_kds')::uuid and to_status = 'ready';

select
  count(*) >= 2 as audit_rows_written,
  bool_and(action = 'UPDATE') as dml_verb_is_update,
  bool_and(operation = 'ADVANCE_ORDER_STATUS') as semantic_operation_recorded,
  bool_and(user_id = '00000000-0000-0000-0000-0000000000b2') as user_recorded,
  bool_and(changed_fields @> array['status']) as status_in_changed_fields,
  bool_and(new_data ->> 'status' is not null) as new_data_present
from public.audit_logs
where table_name = 'orders'
  and record_id = current_setting('test.oid_kds')::uuid
  and operation = 'ADVANCE_ORDER_STATUS';

\echo '=== T53 an impossible transition is refused'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  do $$ begin
    begin
      -- 'ready' cannot go back to 'preparing': a stale board or a double
      -- tap must not drag food back into the kitchen.
      perform public.advance_order_status(current_setting('test.oid_kds')::uuid, 'preparing');
      raise exception 'FAIL: an order went backwards';
    exception when check_violation then raise notice 'PASS: backwards transition refused';
    end;
  end $$;
rollback;

\echo '=== T54 a pickup order cannot be sent out for delivery'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  do $$ begin
    begin
      perform public.advance_order_status(current_setting('test.oid_kds')::uuid, 'out_for_delivery');
      raise exception 'FAIL: a pickup order was sent out for delivery';
    exception when check_violation then raise notice 'PASS: pickup cannot be dispatched';
    end;
  end $$;
rollback;

\echo '=== T55 a customer cannot drive the kitchen board'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');   -- the diner
  set local role authenticated;
  do $$ begin
    begin
      perform public.advance_order_status(current_setting('test.oid_kds')::uuid, 'completed');
      raise exception 'FAIL: a customer advanced their own order';
    exception when insufficient_privilege then
      raise notice 'PASS: customer refused on advance_order_status';
    end;
  end $$;
rollback;

\echo '=== T56 staff of ANOTHER tenant cannot touch this order'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');   -- Maria's owner
  set local role authenticated;
  do $$ begin
    begin
      perform public.advance_order_status(current_setting('test.oid_kds')::uuid, 'completed');
      raise exception 'FAIL: another tenant advanced this order';
    exception when insufficient_privilege then
      raise notice 'PASS: cross-tenant advance refused';
    end;
  end $$;
rollback;

\echo '=== T57 pausing the kitchen writes an immutable audit record'
select count(*) as pause_audits_before from public.audit_logs
 where operation = 'TOGGLE_KITCHEN_PAUSE' \gset

begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  select (public.set_kitchen_pause('11111111-1111-1111-1111-111111111111', true, 'Fryer down'))
           .is_kitchen_paused as paused_on;
commit;

select
  count(*) = :pause_audits_before + 1 as one_new_audit_row,
  bool_and(user_id = '00000000-0000-0000-0000-0000000000b2') as user_recorded,
  bool_and(action = 'UPDATE') as dml_verb_is_update,
  bool_and((new_data ->> 'is_kitchen_paused')::boolean) as new_data_shows_paused,
  bool_and(not (old_data ->> 'is_kitchen_paused')::boolean) as old_data_shows_running,
  bool_and(new_data ->> 'kitchen_paused_reason' = 'Fryer down') as reason_recorded
from public.audit_logs
where operation = 'TOGGLE_KITCHEN_PAUSE';

\echo '=== T58 the pause is visible to the storefront and blocks pricing'
select is_kitchen_paused as storefront_sees_paused
from public.tenant_settings where tenant_id = '11111111-1111-1111-1111-111111111111';

do $$ begin
  begin
    perform public.price_cart('11111111-1111-1111-1111-111111111111',
      '{"fulfillmentType":"pickup","tipCents":0,
        "lines":[{"lineId":"l1","menuItemId":"aaaaaaa3-0000-0000-0000-000000000001","quantity":1}]}'::jsonb);
    raise exception 'FAIL: a paused kitchen priced a cart';
  exception when check_violation then raise notice 'PASS: pausing the kitchen stops checkout';
  end;
end $$;

begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  select (public.set_kitchen_pause('11111111-1111-1111-1111-111111111111', false))
           .is_kitchen_paused = false as resumed;
commit;

\echo '=== T59 audit rows cannot be altered or deleted by any client role'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');   -- tenant OWNER
  set local role authenticated;
  do $$ begin
    begin
      update public.audit_logs set operation = 'REWRITTEN'
       where operation = 'TOGGLE_KITCHEN_PAUSE';
      raise exception 'FAIL: an owner rewrote the audit trail';
    exception when insufficient_privilege then
      raise notice 'PASS: audit_logs cannot be updated';
    end;
    begin
      delete from public.audit_logs where operation = 'TOGGLE_KITCHEN_PAUSE';
      raise exception 'FAIL: an owner deleted an audit row';
    exception when insufficient_privilege then
      raise notice 'PASS: audit_logs cannot be deleted';
    end;
  end $$;
rollback;

\echo '=== T60 prep time adjusts by DELTA and clamps at the boundaries'
update public.tenant_settings set estimated_prep_time_mins = 20
 where tenant_id = '11111111-1111-1111-1111-111111111111';
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', 5))
           .estimated_prep_time_mins = 25 as plus_five;
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', -5))
           .estimated_prep_time_mins = 20 as minus_five;
  -- Two stations tapping "+5" concurrently must add ten, not race to 25.
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', 5))
           .estimated_prep_time_mins = 25 as first_station;
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', 5))
           .estimated_prep_time_mins = 30 as second_station_adds_again;
  -- Cannot be driven below zero or above the cap.
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', -120))
           .estimated_prep_time_mins = 0 as clamped_at_zero;
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', 120))
           .estimated_prep_time_mins = 120 as adds_from_zero;
rollback;

\echo '=== T61 prep-time changes are audited with their own operation'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  set local role authenticated;
  select (public.adjust_prep_time('11111111-1111-1111-1111-111111111111', 5)).tenant_id
           = '11111111-1111-1111-1111-111111111111' as adjusted;
commit;
select count(*) >= 1 as prep_audit_written,
       bool_and(operation = 'ADJUST_PREP_TIME') as operation_recorded
from public.audit_logs where operation = 'ADJUST_PREP_TIME';

\echo '=== T62 a customer cannot pace the kitchen'
begin;
  select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  set local role authenticated;
  do $$ begin
    begin
      perform public.set_kitchen_pause('11111111-1111-1111-1111-111111111111', true, 'lol');
      raise exception 'FAIL: a customer paused the kitchen';
    exception when insufficient_privilege then
      raise notice 'PASS: customer refused on set_kitchen_pause';
    end;
    begin
      perform public.adjust_prep_time('11111111-1111-1111-1111-111111111111', 60);
      raise exception 'FAIL: a customer changed the prep time';
    exception when insufficient_privilege then
      raise notice 'PASS: customer refused on adjust_prep_time';
    end;
  end $$;
rollback;

select set_config('request.jwt.claims', null, false);

\echo ''
\echo '=== SLICE 3 SUITE COMPLETED ==='
