-- =====================================================================
-- 08_menu_sync.sql
-- Marketplace availability sync: tenant isolation, idempotency, and the
-- retry semantics that decide whether a failed event is ever applied.
--
-- The claims under test are the ones that cost money if wrong:
--   * an event naming another restaurant's item cannot touch it
--   * a redelivery is a no-op, not a second write
--   * a FAILED event is retryable, not permanently swallowed
--   * price is never syncable, by construction
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

\set TENANT '0a11ce00-0000-4000-8000-000000000001'
\set MARGHERITA '0a11ce00-0004-4000-8000-000000000001'

-- A second tenant, to prove isolation rather than assume it.
insert into public.tenants (id, name, slug, status)
values ('0b22de00-0000-4000-8000-000000000002', 'Rival Kitchen', 'rival-kitchen', 'active')
on conflict (id) do nothing;

insert into public.menu_categories (id, tenant_id, name, slug, sort_order)
values ('0b22de00-0002-4000-8000-000000000001',
        '0b22de00-0000-4000-8000-000000000002', 'Mains', 'mains', 0)
on conflict (id) do nothing;

insert into public.menu_items (id, tenant_id, category_id, name, slug, price_cents)
values ('0b22de00-0004-4000-8000-000000000001',
        '0b22de00-0000-4000-8000-000000000002',
        '0b22de00-0002-4000-8000-000000000001', 'Rival Burger', 'rival-burger', 1500)
on conflict (id) do nothing;

-- Store + item mappings for both tenants.
insert into public.tenant_external_stores (tenant_id, provider, external_store_id)
values (:'TENANT', 'uber_eats', 'UE-STORE-DEMO'),
       ('0b22de00-0000-4000-8000-000000000002', 'uber_eats', 'UE-STORE-RIVAL')
on conflict (provider, external_store_id) do nothing;

insert into public.menu_item_external_refs (tenant_id, menu_item_id, provider, external_id)
values (:'TENANT', :'MARGHERITA', 'uber_eats', 'UE-ITEM-MARGHERITA'),
       ('0b22de00-0000-4000-8000-000000000002',
        '0b22de00-0004-4000-8000-000000000001', 'uber_eats', 'UE-ITEM-RIVAL')
on conflict (provider, external_id) do nothing;

-- ---------------------------------------------------------------------
-- T1  A valid event applies.
-- ---------------------------------------------------------------------
select 'T1' as test,
       public.apply_menu_availability_event(
         'uber_eats', 'evt-t1', 'menu.availability', '{"a":1}'::jsonb,
         'UE-STORE-DEMO', 'UE-ITEM-MARGHERITA', false
       ) ->> 'status' = 'applied' as passed;

select 'T1b' as test, is_available = false as passed
from public.menu_items where id = :'MARGHERITA';

-- ---------------------------------------------------------------------
-- T2  Redelivery of the same event id is a no-op.
--     Flip availability underneath it first: if the redelivery were
--     re-applied it would set it back, and the assertion would fail.
-- ---------------------------------------------------------------------
update public.menu_items set is_available = true where id = :'MARGHERITA';

select 'T2' as test,
       public.apply_menu_availability_event(
         'uber_eats', 'evt-t1', 'menu.availability', '{"a":1}'::jsonb,
         'UE-STORE-DEMO', 'UE-ITEM-MARGHERITA', false
       ) ->> 'status' = 'duplicate' as passed;

select 'T2b' as test, is_available = true as passed
from public.menu_items where id = :'MARGHERITA';

-- ---------------------------------------------------------------------
-- T3  CROSS-TENANT: the rival's store id with our item id.
--     This is the attack the store lookup exists to stop.
-- ---------------------------------------------------------------------
select 'T3' as test,
       public.apply_menu_availability_event(
         'uber_eats', 'evt-t3', 'menu.availability', '{}'::jsonb,
         'UE-STORE-RIVAL', 'UE-ITEM-MARGHERITA', false
       ) ->> 'status' = 'unknown_item' as passed;

select 'T3b' as test, is_available = true as passed
from public.menu_items where id = :'MARGHERITA';

-- ---------------------------------------------------------------------
-- T4  An unmapped store is refused.
-- ---------------------------------------------------------------------
select 'T4' as test,
       public.apply_menu_availability_event(
         'uber_eats', 'evt-t4', 'menu.availability', '{}'::jsonb,
         'UE-STORE-NOBODY', 'UE-ITEM-MARGHERITA', false
       ) ->> 'status' = 'unknown_store' as passed;

-- ---------------------------------------------------------------------
-- T5  A FAILED event is retryable.
--     evt-t4 failed on an unknown store. If the mapping is then created,
--     the SAME event id must apply rather than be discarded as a
--     duplicate — otherwise a mid-onboarding event is lost forever.
-- ---------------------------------------------------------------------
insert into public.tenant_external_stores (tenant_id, provider, external_store_id)
values (:'TENANT', 'uber_eats', 'UE-STORE-NOBODY')
on conflict (provider, external_store_id) do nothing;

select 'T5' as test,
       public.apply_menu_availability_event(
         'uber_eats', 'evt-t4', 'menu.availability', '{}'::jsonb,
         'UE-STORE-NOBODY', 'UE-ITEM-MARGHERITA', false
       ) ->> 'status' = 'applied' as passed;

-- ---------------------------------------------------------------------
-- T6  Exactly one ledger row per event id, however many attempts.
-- ---------------------------------------------------------------------
select 'T6' as test, count(*) = 1 as passed
from public.inbound_webhook_events
where provider = 'uber_eats' and event_id = 'evt-t4';

-- ---------------------------------------------------------------------
-- T7  A successful event is stamped processed and attributed to a tenant.
-- ---------------------------------------------------------------------
select 'T7' as test, processed_at is not null and tenant_id = :'TENANT'::uuid as passed
from public.inbound_webhook_events
where provider = 'uber_eats' and event_id = 'evt-t1';

-- ---------------------------------------------------------------------
-- T8  Price is not syncable. The RPC takes no price argument at all —
--     a design constraint, checked so it cannot be widened by accident.
-- ---------------------------------------------------------------------
select 'T8' as test,
       not exists (
         select 1 from information_schema.parameters
         where specific_schema = 'public'
           and specific_name like 'apply_menu_availability_event%'
           and parameter_name ilike '%price%'
       ) as passed;

-- ---------------------------------------------------------------------
-- T9  The mapping tables are not readable by anon.
--     Tables created after the security migration inherit Supabase's
--     default grants; this is the guard for that bug class.
-- ---------------------------------------------------------------------
select 'T9' as test,
       not has_table_privilege('anon', 'public.tenant_external_stores', 'select')
       and not has_table_privilege('anon', 'public.menu_item_external_refs', 'select') as passed;

-- ---------------------------------------------------------------------
-- T10 No client role may invoke the RPC: it is SECURITY DEFINER and
--     bypasses RLS by design.
-- ---------------------------------------------------------------------
select 'T10' as test,
       not has_function_privilege('anon',
         'public.apply_menu_availability_event(text,text,text,jsonb,text,text,boolean)', 'execute')
       and not has_function_privilege('authenticated',
         'public.apply_menu_availability_event(text,text,text,jsonb,text,text,boolean)', 'execute') as passed;

-- ---------------------------------------------------------------------
-- T11 The availability write is audited.
-- ---------------------------------------------------------------------
select 'T11' as test, count(*) > 0 as passed
from public.audit_logs
where operation = 'marketplace_menu_sync';

-- Clean up the isolation fixture.
delete from public.tenants where id = '0b22de00-0000-4000-8000-000000000002';
delete from public.inbound_webhook_events where provider = 'uber_eats' and event_id like 'evt-t%';
