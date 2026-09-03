-- ---------------------------------------------------------------------
-- Marketplace menu sync.
--
-- A restaurant listed on a delivery marketplace has two menus that must
-- agree: ours and theirs. When they 86 an item on their tablet, our
-- storefront has to stop selling it, or a customer pays for food that
-- does not exist.
--
-- External ids live in join tables rather than as columns on menu_items,
-- because one item can be listed on several marketplaces and each has its
-- own id namespace. Putting them inline would mean a column per provider
-- and a unique index that cannot express "unique within provider".
-- ---------------------------------------------------------------------

-- The idempotency ledger's provider check predates marketplace events.
alter table public.inbound_webhook_events
  drop constraint if exists inbound_webhook_events_provider_chk;

alter table public.inbound_webhook_events
  add constraint inbound_webhook_events_provider_chk
    check (provider in ('stripe', 'square', 'paypal', 'shipday', 'uber_direct', 'uber_eats'));

-- ---------------------------------------------------------------------
-- Store mapping: which tenant is this marketplace storefront?
-- ---------------------------------------------------------------------
create table public.tenant_external_stores (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  provider           text not null,
  external_store_id  text not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint tenant_external_stores_provider_chk
    check (provider in ('uber_eats', 'doordash', 'grubhub')),
  constraint tenant_external_stores_id_chk
    check (length(btrim(external_store_id)) between 1 and 200)
);

-- One marketplace storefront belongs to exactly one tenant. This is the
-- constraint that makes cross-tenant writes impossible rather than
-- merely unlikely.
create unique index tenant_external_stores_provider_store_key
  on public.tenant_external_stores (provider, external_store_id);

create index tenant_external_stores_tenant_idx
  on public.tenant_external_stores (tenant_id);

-- ---------------------------------------------------------------------
-- Item mapping
-- ---------------------------------------------------------------------
create table public.menu_item_external_refs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  provider      text not null,
  external_id   text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint menu_item_external_refs_provider_chk
    check (provider in ('uber_eats', 'doordash', 'grubhub')),
  constraint menu_item_external_refs_id_chk
    check (length(btrim(external_id)) between 1 and 200)
);

create unique index menu_item_external_refs_provider_external_key
  on public.menu_item_external_refs (provider, external_id);

create unique index menu_item_external_refs_item_provider_key
  on public.menu_item_external_refs (menu_item_id, provider);

create index menu_item_external_refs_tenant_idx
  on public.menu_item_external_refs (tenant_id);

-- ---------------------------------------------------------------------
-- apply_menu_availability_event()
--
-- Idempotency, resolution and the write in ONE transaction, because they
-- are only correct together. Claiming the event in the ledger from the
-- caller and then updating separately means a crash in between marks an
-- event processed that was never applied — and the retry is discarded as
-- a duplicate. The item stays for sale and nobody finds out until someone
-- orders it.
--
-- Returns a status rather than raising, so the caller can answer the
-- marketplace correctly: a redelivery is a success, not an error.
-- ---------------------------------------------------------------------
create or replace function public.apply_menu_availability_event(
  p_provider     text,
  p_event_id     text,
  p_event_type   text,
  p_payload      jsonb,
  p_store_id     text,
  p_external_id  text,
  p_available    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id  uuid;
  v_item_id    uuid;
  v_event_pk   uuid;
  v_processed  timestamptz;
begin
  if p_provider is null or p_event_id is null or p_external_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Claim the event. A row that exists AND is processed is a redelivery;
  -- a row that exists and is NOT processed is a retry of a failed attempt
  -- and must be allowed through.
  insert into public.inbound_webhook_events (provider, event_id, event_type, payload)
  values (p_provider, p_event_id, coalesce(p_event_type, 'menu.availability'), coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_event_pk;

  if v_event_pk is null then
    select id, processed_at into v_event_pk, v_processed
    from public.inbound_webhook_events
    where provider = p_provider and event_id = p_event_id;

    if v_processed is not null then
      return jsonb_build_object('status', 'duplicate');
    end if;
  end if;

  -- Resolve the storefront FIRST. The item id alone is not enough: it is
  -- the marketplace's identifier, and trusting it on its own would let an
  -- event naming another restaurant's item update that restaurant's menu.
  select tenant_id into v_tenant_id
  from public.tenant_external_stores
  where provider = p_provider
    and external_store_id = p_store_id
    and is_active
  limit 1;

  if v_tenant_id is null then
    update public.inbound_webhook_events
       set attempts = attempts + 1, error = 'unknown store'
     where id = v_event_pk;
    return jsonb_build_object('status', 'unknown_store');
  end if;

  -- The item must belong to the store that sent the event.
  select menu_item_id into v_item_id
  from public.menu_item_external_refs
  where provider = p_provider
    and external_id = p_external_id
    and tenant_id = v_tenant_id
  limit 1;

  if v_item_id is null then
    update public.inbound_webhook_events
       set attempts = attempts + 1, error = 'unknown item for store'
     where id = v_event_pk;
    return jsonb_build_object('status', 'unknown_item');
  end if;

  perform set_config('app.audit_operation', 'marketplace_menu_sync', true);

  update public.menu_items
     set is_available = p_available,
         updated_at   = now()
   where id = v_item_id
     and tenant_id = v_tenant_id;

  if not found then
    update public.inbound_webhook_events
       set attempts = attempts + 1, error = 'item vanished'
     where id = v_event_pk;
    return jsonb_build_object('status', 'unknown_item');
  end if;

  update public.inbound_webhook_events
     set processed_at = now(), tenant_id = v_tenant_id, error = null
   where id = v_event_pk;

  return jsonb_build_object('status', 'applied', 'menu_item_id', v_item_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Security.
--
-- Tables created after the security migration inherit Supabase's default
-- grants to anon/authenticated. Enabling RLS without revoking those
-- leaves the grant in place for any future policy to accidentally widen,
-- so revoke explicitly — this has bitten this schema before.
-- ---------------------------------------------------------------------
alter table public.tenant_external_stores enable row level security;
alter table public.tenant_external_stores force row level security;
alter table public.menu_item_external_refs enable row level security;
alter table public.menu_item_external_refs force row level security;

revoke all on public.tenant_external_stores from anon, authenticated;
revoke all on public.menu_item_external_refs from anon, authenticated;

-- Owners and managers may read their own mappings, to see what is linked.
grant select on public.tenant_external_stores to authenticated;
grant select on public.menu_item_external_refs to authenticated;

create policy tenant_external_stores_read_own
  on public.tenant_external_stores for select to authenticated
  using (public.can_manage_tenant(tenant_id));

create policy menu_item_external_refs_read_own
  on public.menu_item_external_refs for select to authenticated
  using (public.can_manage_tenant(tenant_id));

-- Writes are service-role only: the mappings are established during
-- marketplace onboarding, not by a restaurant editing a form.

-- The RPC is called by the Edge Function with the service role. No client
-- role may invoke it — it bypasses RLS by design.
revoke all on function public.apply_menu_availability_event(text, text, text, jsonb, text, text, boolean)
  from public, anon, authenticated;

select public.attach_audit_trigger('tenant_external_stores');
select public.attach_audit_trigger('menu_item_external_refs');
