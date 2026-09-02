-- =====================================================================
-- 01_schema_integrity.sql
-- Triggers, constraints, and money invariants. Run against a freshly
-- reset local database:  ./scripts/run-sql-tests.sh
--
-- Every negative case raises 'FAIL: ...' (errcode P0001) which the
-- surrounding handler does NOT catch, so a regression aborts the run
-- under \set ON_ERROR_STOP.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===== fixtures =======================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@platform.test','x',now(),now(),now(),'{}','{}', '', '', '', ''),
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@joes.test','x',now(),now(),now(),'{}','{}', '', '', '', ''),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff-a@joes.test','x',now(),now(),now(),'{}','{}', '', '', '', ''),
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b@marias.test','x',now(),now(),now(),'{}','{}', '', '', '', ''),
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','diner@example.test','x',now(),now(),now(),'{}','{}', '', '', '', '');

insert into public.tenants (id, slug, name, status) values
 ('11111111-1111-1111-1111-111111111111','joes','Joe''s Pizza','active'),
 ('22222222-2222-2222-2222-222222222222','marias','Maria''s Tacos','active');

update public.user_profiles set role='super_admin', tenant_id=null where id='00000000-0000-0000-0000-0000000000a1';
update public.user_profiles set role='tenant_owner', tenant_id='11111111-1111-1111-1111-111111111111' where id='00000000-0000-0000-0000-0000000000b1';
update public.user_profiles set role='tenant_staff', tenant_id='11111111-1111-1111-1111-111111111111' where id='00000000-0000-0000-0000-0000000000b2';
update public.user_profiles set role='tenant_owner', tenant_id='22222222-2222-2222-2222-222222222222' where id='00000000-0000-0000-0000-0000000000c1';
update public.user_profiles set role='customer',     tenant_id='11111111-1111-1111-1111-111111111111' where id='00000000-0000-0000-0000-0000000000d1';

\echo ''
\echo '=== T1  settings auto-provisioned for every tenant'
-- The invariant is one settings row per tenant, not a literal count: the
-- demo seed in supabase/seed.sql adds a tenant of its own.
select (select count(*) from public.tenants) = (select count(*) from public.tenant_settings)
       as every_tenant_has_settings,
       (select count(*) from public.tenants t
         where not exists (select 1 from public.tenant_settings s where s.tenant_id = t.id)) = 0
       as none_missing;

\echo '=== T2  reserved subdomain is rejected'
do $$ begin
  begin
    insert into public.tenants (slug, name) values ('admin','Evil Co');
    raise exception 'FAIL: reserved slug accepted';
  exception when check_violation then raise notice 'PASS: reserved slug rejected';
  end;
end $$;

\echo '=== T3  hostname normalisation strips scheme/port/path'
-- One verified domain (routable) and one still awaiting DNS verification
-- (must NOT route) -- see T21 in the RLS suite.
insert into public.tenant_domains (tenant_id, hostname, is_primary, verified_at)
values ('11111111-1111-1111-1111-111111111111','HTTPS://Orders.JoesPizza.com:443/menu', true, now());
insert into public.tenant_domains (tenant_id, hostname)
values ('11111111-1111-1111-1111-111111111111','staging.joespizza.com');
select hostname = 'orders.joespizza.com' as pass
from public.tenant_domains where is_primary;

\echo '=== T4  cross-tenant category reference is impossible'
insert into public.menu_categories (id, tenant_id, name, slug) values
 ('aaaaaaa1-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Pizzas','pizzas'),
 ('bbbbbbb1-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Tacos','tacos');
do $$ begin
  begin
    insert into public.menu_items (tenant_id, category_id, name, slug, price_cents)
    values ('11111111-1111-1111-1111-111111111111','bbbbbbb1-0000-0000-0000-000000000001','Stolen','stolen',100);
    raise exception 'FAIL: cross-tenant category accepted';
  exception when foreign_key_violation then raise notice 'PASS: cross-tenant category rejected';
  end;
end $$;

insert into public.menu_items (id, tenant_id, category_id, name, slug, price_cents) values
 ('aaaaaaa2-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaa1-0000-0000-0000-000000000001','Margherita','margherita',1400);

\echo '=== T5  tech fee OFF: an order that charges one anyway is rejected at COMMIT'
do $$ begin
  begin
    insert into public.orders (id, tenant_id, status, customer_name, customer_phone,
      fulfillment_type, subtotal_cents, tech_fee_cents, total_cents)
    values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','paid',
            'Test','5551234567','pickup', 1400, 100, 1500);
    insert into public.order_items (tenant_id, order_id, name_snapshot, unit_price_cents, quantity, line_total_cents)
    values ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','Margherita',1400,1,1400);
    set constraints all immediate;   -- force the deferred check inside this block
    raise exception 'FAIL: unconfigured tech fee accepted';
  exception when check_violation then raise notice 'PASS: unconfigured tech fee rejected';
  end;
end $$;

\echo '=== T6  subtotal that disagrees with the line items is rejected at COMMIT'
update public.tenant_settings set tech_fee_enabled = true
 where tenant_id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    insert into public.orders (id, tenant_id, status, customer_name, customer_phone,
      fulfillment_type, subtotal_cents, tech_fee_cents, total_cents)
    values ('dddddddd-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','paid',
            'Test','5551234567','pickup', 100, 100, 200);
    insert into public.order_items (tenant_id, order_id, name_snapshot, unit_price_cents, quantity, line_total_cents)
    values ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000002','Margherita',1400,1,1400);
    set constraints all immediate;
    raise exception 'FAIL: mismatched subtotal accepted';
  exception when check_violation then raise notice 'PASS: mismatched subtotal rejected';
  end;
end $$;

\echo '=== T7  a correct order commits, gets a number, and logs a status event'
begin;
insert into public.orders (id, tenant_id, status, customer_user_id, customer_name, customer_phone,
  fulfillment_type, subtotal_cents, tax_cents, tip_cents, tech_fee_cents, total_cents)
values ('dddddddd-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','paid',
        '00000000-0000-0000-0000-0000000000d1','Dana','5551234567','pickup', 1400, 123, 200, 100, 1823);
insert into public.order_items (tenant_id, order_id, menu_item_id, name_snapshot, unit_price_cents, quantity, line_total_cents)
values ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000003',
        'aaaaaaa2-0000-0000-0000-000000000001','Margherita',1400,1,1400);
commit;
select order_number ~ '^[0-9]{6}-0001$' as number_pass,
       placed_at is not null as placed_pass
from public.orders where id='dddddddd-0000-0000-0000-000000000003';
select count(*) = 1 as status_event_pass from public.order_status_events
 where order_id='dddddddd-0000-0000-0000-000000000003';

\echo '=== T8  status transition stamps lifecycle timestamps'
update public.orders set status='completed' where id='dddddddd-0000-0000-0000-000000000003';
select completed_at is not null as pass from public.orders where id='dddddddd-0000-0000-0000-000000000003';

\echo '=== T9  audit trail captured the menu item and the order'
select
  (select count(*) from public.audit_logs where table_name='menu_items') >= 1 as menu_pass,
  (select count(*) from public.audit_logs where table_name='orders' and action='UPDATE') >= 1 as order_pass,
  (select changed_fields @> array['status'] from public.audit_logs
    where table_name='orders' and action='UPDATE' order by id desc limit 1) as fields_pass;

\echo '=== T10 updated_at-only churn does NOT create audit noise'
select count(*) as before_count from public.audit_logs where table_name='menu_items' \gset
update public.menu_items set updated_at = now() where id='aaaaaaa2-0000-0000-0000-000000000001';
select count(*) = :before_count as pass from public.audit_logs where table_name='menu_items';
