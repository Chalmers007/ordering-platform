-- =====================================================================
-- 20260902090600_checkout.sql
-- Checkout: authoritative server-side pricing, a durable cart snapshot,
-- inbound webhook idempotency, and one atomic order-creation function.
--
-- Why pricing lives in SQL
-- ------------------------
-- The money invariants are already enforced here (orders_total_chk and the
-- deferred orders_validate_totals trigger). Computing the same figures in
-- TypeScript would put the calculation and its enforcement in two places
-- that drift. price_cart() is the single authority; the API route only
-- passes the customer's *selections*, never any prices.
-- =====================================================================

set check_function_bodies = off;

create type public.checkout_session_status as enum (
  'open', 'completed', 'expired', 'cancelled'
);

-- ---------------------------------------------------------------------
-- checkout_sessions
--
-- Stripe metadata caps at 500 characters per value, which a cart with
-- modifiers blows through immediately. So the priced cart is persisted
-- here and Stripe carries only this row's id. The webhook then builds the
-- order from the snapshot the server priced -- never from anything the
-- client sent back.
-- ---------------------------------------------------------------------
create table public.checkout_sessions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  status                    public.checkout_session_status not null default 'open',

  created_by                uuid references auth.users(id) on delete set null,

  provider                  public.payment_provider not null default 'stripe',
  provider_session_id       text,
  provider_payment_intent_id text,

  -- Output of price_cart(): the exact figures the order will be built from.
  priced_cart               jsonb not null,

  fulfillment_type          public.fulfillment_type not null,
  customer_name             text not null,
  customer_phone            text not null,
  customer_email            text,

  delivery_address_line1    text,
  delivery_address_line2    text,
  delivery_city             text,
  delivery_region           text,
  delivery_postal_code      text,
  delivery_country          char(2) default 'US',
  delivery_latitude         double precision,
  delivery_longitude        double precision,
  delivery_instructions     text,

  order_id                  uuid references public.orders(id) on delete set null,

  expires_at                timestamptz not null default now() + interval '2 hours',
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint checkout_sessions_priced_cart_chk check (jsonb_typeof(priced_cart) = 'object'),
  constraint checkout_sessions_delivery_chk check (
    fulfillment_type <> 'delivery'
    or (delivery_address_line1 is not null and delivery_city is not null
        and delivery_postal_code is not null)
  )
);

create unique index checkout_sessions_provider_session_key
  on public.checkout_sessions (provider, provider_session_id)
  where provider_session_id is not null;
create index checkout_sessions_tenant_idx on public.checkout_sessions (tenant_id, created_at desc);
create index checkout_sessions_open_idx on public.checkout_sessions (expires_at)
  where status = 'open';

create trigger checkout_sessions_set_updated_at
  before update on public.checkout_sessions
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- inbound_webhook_events
--
-- Idempotency ledger for events we RECEIVE. Deliberately separate from
-- public.webhook_events, which is the outbox for events we SEND to
-- GoHighLevel: opposite direction, different retry semantics, different
-- lifecycle. Overloading one table for both makes neither honest.
--
-- The unique index on (provider, event_id) is the idempotency guarantee:
-- Stripe redelivers, and the second delivery loses the insert race.
-- ---------------------------------------------------------------------
create table public.inbound_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      public.payment_provider not null,
  event_id      text not null,
  event_type    text not null,
  tenant_id     uuid references public.tenants(id) on delete set null,
  order_id      uuid references public.orders(id) on delete set null,
  payload       jsonb not null,
  processed_at  timestamptz,
  error         text,
  attempts      integer not null default 0,
  received_at   timestamptz not null default now(),

  constraint inbound_webhook_events_payload_chk check (jsonb_typeof(payload) = 'object')
);

create unique index inbound_webhook_events_provider_event_key
  on public.inbound_webhook_events (provider, event_id);
create index inbound_webhook_events_unprocessed_idx
  on public.inbound_webhook_events (received_at) where processed_at is null;

-- Both tables are service-role only: RLS on, zero policies, zero grants.
alter table public.checkout_sessions      enable row level security;
alter table public.inbound_webhook_events enable row level security;
alter table public.checkout_sessions      force row level security;
alter table public.inbound_webhook_events force row level security;

-- Supabase's default privileges grant new tables to anon/authenticated, and
-- the blanket REVOKE in the security migration ran before these tables
-- existed. Without this, RLS-with-no-policies would return 0 rows where it
-- should refuse outright -- so revoke explicitly, at creation.
revoke all on public.checkout_sessions      from anon, authenticated;
revoke all on public.inbound_webhook_events from anon, authenticated;

comment on table public.checkout_sessions is
  'Service-role only. RLS enabled with no policies by design.';
comment on table public.inbound_webhook_events is
  'Service-role only. Idempotency ledger for received payment webhooks.';

-- ---------------------------------------------------------------------
-- price_cart()
--
-- The only place prices are computed. Takes selections, returns money.
--
-- Every price is read from the database. A modifier is only accepted if
-- its group is actually attached to the item being ordered -- otherwise a
-- caller could reference a cheap or negative-priced modifier from an
-- unrelated item and pay less than the menu says.
-- ---------------------------------------------------------------------
create or replace function public.price_cart(
  p_tenant_id uuid,
  p_cart      jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings        public.tenant_settings%rowtype;
  v_tenant          public.tenants%rowtype;
  v_line            jsonb;
  v_mod             jsonb;
  v_item            public.menu_items%rowtype;
  -- A record, not %rowtype: PL/pgSQL forbids a rowtype variable in a
  -- multi-item INTO list, and this select carries the group name too.
  v_modifier        record;
  v_quantity        integer;
  v_mod_quantity    integer;
  v_mods_total      integer;
  v_line_total      integer;
  v_lines           jsonb := '[]'::jsonb;
  v_mod_lines       jsonb;
  v_subtotal        integer := 0;
  v_taxable_base    integer := 0;
  v_fulfillment     public.fulfillment_type;
  v_tip             integer;
  v_tax             integer;
  v_service_fee     integer;
  v_delivery_fee    integer;
  v_tech_fee        integer;
  v_total           integer;
  v_group_counts    jsonb := '{}'::jsonb;
  v_group           record;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or v_tenant.status <> 'active' then
    raise exception 'This restaurant is not accepting orders' using errcode = 'check_violation';
  end if;

  select * into v_settings from public.tenant_settings where tenant_id = p_tenant_id;
  if not found then
    raise exception 'Restaurant is not configured' using errcode = 'check_violation';
  end if;

  if v_settings.is_kitchen_paused then
    raise exception 'This kitchen is currently paused and not accepting orders'
      using errcode = 'check_violation';
  end if;

  v_fulfillment := coalesce(nullif(p_cart ->> 'fulfillmentType', ''), 'delivery')::public.fulfillment_type;

  if v_fulfillment = 'delivery' and not v_settings.accepts_delivery then
    raise exception 'This restaurant is not accepting delivery orders' using errcode = 'check_violation';
  end if;
  if v_fulfillment = 'pickup' and not v_settings.accepts_pickup then
    raise exception 'This restaurant is not accepting pickup orders' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_cart -> 'lines') <> 'array' or jsonb_array_length(p_cart -> 'lines') = 0 then
    raise exception 'Cart is empty' using errcode = 'check_violation';
  end if;

  -- ---- lines --------------------------------------------------------
  for v_line in select jsonb_array_elements(p_cart -> 'lines')
  loop
    v_quantity := coalesce((v_line ->> 'quantity')::integer, 0);
    if v_quantity < 1 or v_quantity > 999 then
      raise exception 'Invalid quantity for a cart line' using errcode = 'check_violation';
    end if;

    select * into v_item
    from public.menu_items
    where id = (v_line ->> 'menuItemId')::uuid
      and tenant_id = p_tenant_id;

    if not found then
      raise exception 'Menu item % is not on this menu', v_line ->> 'menuItemId'
        using errcode = 'check_violation';
    end if;
    if not v_item.is_available then
      raise exception '% is sold out', v_item.name using errcode = 'check_violation';
    end if;
    if v_item.stock_quantity is not null and v_item.stock_quantity < v_quantity then
      raise exception 'Only % of % left', v_item.stock_quantity, v_item.name
        using errcode = 'check_violation';
    end if;

    v_mods_total := 0;
    v_mod_lines  := '[]'::jsonb;
    v_group_counts := '{}'::jsonb;

    if jsonb_typeof(v_line -> 'modifiers') = 'array' then
      for v_mod in select jsonb_array_elements(v_line -> 'modifiers')
      loop
        v_mod_quantity := coalesce((v_mod ->> 'quantity')::integer, 1);
        if v_mod_quantity < 1 or v_mod_quantity > 99 then
          raise exception 'Invalid modifier quantity' using errcode = 'check_violation';
        end if;

        -- The join through menu_item_modifier_groups is the security check:
        -- a modifier not attached to THIS item cannot be priced.
        select m.id, m.name, m.group_id, m.price_delta_cents, m.is_available,
               g.name as group_name
          into v_modifier
        from public.menu_modifiers m
        join public.menu_modifier_groups g on g.id = m.group_id
        join public.menu_item_modifier_groups img
          on img.group_id = g.id and img.item_id = v_item.id
        where m.id = (v_mod ->> 'modifierId')::uuid
          and m.tenant_id = p_tenant_id
          and g.is_active;

        if not found then
          raise exception 'Option is not available for %', v_item.name
            using errcode = 'check_violation';
        end if;
        if not v_modifier.is_available then
          raise exception '% is unavailable', v_modifier.name using errcode = 'check_violation';
        end if;

        v_group_counts := jsonb_set(
          v_group_counts,
          array[v_modifier.group_id::text],
          to_jsonb(coalesce((v_group_counts ->> v_modifier.group_id::text)::integer, 0) + v_mod_quantity),
          true
        );

        v_mods_total := v_mods_total + (v_modifier.price_delta_cents * v_mod_quantity);
        v_mod_lines := v_mod_lines || jsonb_build_object(
          'modifierId',      v_modifier.id,
          'groupName',       v_modifier.group_name,
          'name',            v_modifier.name,
          'priceDeltaCents', v_modifier.price_delta_cents,
          'quantity',        v_mod_quantity
        );
      end loop;
    end if;

    -- Required / min / max selections, per group attached to this item.
    for v_group in
      select g.id, g.name, g.is_required, g.min_selections, g.max_selections
      from public.menu_item_modifier_groups img
      join public.menu_modifier_groups g on g.id = img.group_id
      where img.item_id = v_item.id and g.is_active
    loop
      declare
        v_count integer := coalesce((v_group_counts ->> v_group.id::text)::integer, 0);
      begin
        if v_group.is_required and v_count < greatest(v_group.min_selections, 1) then
          raise exception '% requires a selection for "%"', v_item.name, v_group.name
            using errcode = 'check_violation';
        end if;
        if v_count > 0 and v_count < v_group.min_selections then
          raise exception '"%" needs at least % selection(s)', v_group.name, v_group.min_selections
            using errcode = 'check_violation';
        end if;
        if v_group.max_selections is not null and v_count > v_group.max_selections then
          raise exception '"%" allows at most % selection(s)', v_group.name, v_group.max_selections
            using errcode = 'check_violation';
        end if;
      end;
    end loop;

    v_line_total := (v_item.price_cents + v_mods_total) * v_quantity;
    v_subtotal := v_subtotal + v_line_total;
    if v_item.is_taxable then
      v_taxable_base := v_taxable_base + v_line_total;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'lineId',              coalesce(v_line ->> 'lineId', v_item.id::text),
      'menuItemId',          v_item.id,
      'name',                v_item.name,
      'quantity',            v_quantity,
      'unitPriceCents',      v_item.price_cents,
      'modifiersTotalCents', v_mods_total,
      'lineTotalCents',      v_line_total,
      'notes',               nullif(v_line ->> 'notes', ''),
      'modifiers',           v_mod_lines
    );
  end loop;

  -- ---- order-level money -------------------------------------------
  v_tip := greatest(coalesce((p_cart ->> 'tipCents')::integer, 0), 0);

  v_delivery_fee := case when v_fulfillment = 'delivery' then v_settings.delivery_fee_cents else 0 end;

  if v_fulfillment = 'delivery' and v_subtotal < v_settings.delivery_minimum_cents then
    raise exception 'Delivery orders have a minimum of %.% -- add % more',
      v_settings.delivery_minimum_cents / 100,
      lpad((v_settings.delivery_minimum_cents % 100)::text, 2, '0'),
      (v_settings.delivery_minimum_cents - v_subtotal)
      using errcode = 'check_violation';
  end if;

  -- Banker-free, deterministic rounding: the same arithmetic the deferred
  -- trigger will re-derive at COMMIT.
  v_tax         := round(v_taxable_base * v_settings.tax_rate_bps / 10000.0)::integer;
  v_service_fee := round(v_subtotal * v_settings.service_fee_bps / 10000.0)::integer;
  v_tech_fee    := case when v_settings.tech_fee_enabled then v_settings.tech_fee_cents else 0 end;

  v_total := v_subtotal + v_tax + v_tip + v_delivery_fee + v_service_fee + v_tech_fee;

  return jsonb_build_object(
    'lines',            v_lines,
    'subtotalCents',    v_subtotal,
    'discountCents',    0,          -- promotions are not part of this slice
    'taxCents',         v_tax,
    'tipCents',         v_tip,
    'deliveryFeeCents', v_delivery_fee,
    'serviceFeeCents',  v_service_fee,
    'techFeeCents',     v_tech_fee,
    'totalCents',       v_total,
    'currency',         v_tenant.currency,
    'fulfillmentType',  v_fulfillment
  );
end;
$$;

comment on function public.price_cart(uuid, jsonb) is
  'Authoritative cart pricing. Reads every price from the database; the caller supplies selections only.';

-- ---------------------------------------------------------------------
-- open_checkout_session()
--
-- Prices the cart and persists the snapshot. Called by the authenticated
-- customer (guest checkout still authenticates via SMS OTP), so the
-- identity check is auth.uid() rather than trust in the API route.
-- ---------------------------------------------------------------------
create or replace function public.open_checkout_session(
  p_tenant_id uuid,
  p_cart      jsonb,
  p_customer  jsonb,
  p_delivery  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_priced      jsonb;
  v_fulfillment public.fulfillment_type;
  v_session_id  uuid;
begin
  if v_uid is null then
    raise exception 'You must verify your phone number before checking out'
      using errcode = 'insufficient_privilege';
  end if;

  v_priced := public.price_cart(p_tenant_id, p_cart);
  v_fulfillment := (v_priced ->> 'fulfillmentType')::public.fulfillment_type;

  if coalesce(length(btrim(p_customer ->> 'name')), 0) = 0
     or coalesce(length(btrim(p_customer ->> 'phone')), 0) < 7 then
    raise exception 'A name and phone number are required' using errcode = 'check_violation';
  end if;

  insert into public.checkout_sessions (
    tenant_id, created_by, provider, priced_cart, fulfillment_type,
    customer_name, customer_phone, customer_email,
    delivery_address_line1, delivery_address_line2, delivery_city,
    delivery_region, delivery_postal_code, delivery_country,
    delivery_latitude, delivery_longitude, delivery_instructions
  ) values (
    p_tenant_id, v_uid, 'stripe', v_priced, v_fulfillment,
    btrim(p_customer ->> 'name'), btrim(p_customer ->> 'phone'),
    nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
    nullif(p_delivery ->> 'addressLine1', ''), nullif(p_delivery ->> 'addressLine2', ''),
    nullif(p_delivery ->> 'city', ''), nullif(p_delivery ->> 'region', ''),
    nullif(p_delivery ->> 'postalCode', ''), coalesce(nullif(p_delivery ->> 'country', ''), 'US'),
    nullif(p_delivery ->> 'latitude', '')::double precision,
    nullif(p_delivery ->> 'longitude', '')::double precision,
    nullif(p_delivery ->> 'instructions', '')
  )
  returning id into v_session_id;

  return jsonb_build_object('sessionId', v_session_id, 'pricedCart', v_priced);
end;
$$;

-- ---------------------------------------------------------------------
-- create_order_from_checkout()
--
-- One transaction: order + line items + modifiers + dispatch row + the
-- outbound GHL events. Called only by service_role, from the verified
-- Stripe webhook.
--
-- Idempotent by construction: a session that already produced an order
-- returns that order id and writes nothing. Stripe WILL redeliver.
-- ---------------------------------------------------------------------
create or replace function public.create_order_from_checkout(
  p_session_id            uuid,
  p_payment_intent_id     text default null,
  p_charge_id             text default null,
  p_application_fee_cents integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s          public.checkout_sessions%rowtype;
  v_cart       jsonb;
  v_order_id   uuid;
  v_line       jsonb;
  v_mod        jsonb;
  v_item_id    uuid;
  v_first_time boolean;
  v_sort       integer := 0;
  v_tenant     public.tenants%rowtype;
begin
  select * into v_s from public.checkout_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Unknown checkout session %', p_session_id using errcode = 'no_data_found';
  end if;

  -- Redelivery: nothing to do.
  if v_s.order_id is not null then
    return v_s.order_id;
  end if;

  if v_s.status = 'cancelled' then
    raise exception 'Checkout session % was cancelled', p_session_id using errcode = 'check_violation';
  end if;

  v_cart := v_s.priced_cart;
  select * into v_tenant from public.tenants where id = v_s.tenant_id;

  -- First-time customer is decided by prior *placed* orders on this
  -- tenant for this phone number, before the new row exists.
  select not exists (
    select 1 from public.orders o
    where o.tenant_id = v_s.tenant_id
      and o.customer_phone = v_s.customer_phone
      and o.status <> 'draft'
  ) into v_first_time;

  insert into public.orders (
    tenant_id, status, payment_status, fulfillment_type,
    customer_user_id, customer_name, customer_phone, customer_email,
    is_first_time_customer,
    delivery_address_line1, delivery_address_line2, delivery_city,
    delivery_region, delivery_postal_code, delivery_country,
    delivery_latitude, delivery_longitude, delivery_instructions,
    subtotal_cents, discount_cents, tax_cents, tip_cents,
    delivery_fee_cents, service_fee_cents, tech_fee_cents, total_cents,
    currency, payment_provider, payment_intent_id, payment_charge_id,
    application_fee_cents, prep_time_mins, promised_at
  )
  select
    v_s.tenant_id, 'paid', 'paid', v_s.fulfillment_type,
    v_s.created_by, v_s.customer_name, v_s.customer_phone, v_s.customer_email,
    v_first_time,
    v_s.delivery_address_line1, v_s.delivery_address_line2, v_s.delivery_city,
    v_s.delivery_region, v_s.delivery_postal_code, v_s.delivery_country,
    v_s.delivery_latitude, v_s.delivery_longitude, v_s.delivery_instructions,
    (v_cart ->> 'subtotalCents')::integer, (v_cart ->> 'discountCents')::integer,
    (v_cart ->> 'taxCents')::integer, (v_cart ->> 'tipCents')::integer,
    (v_cart ->> 'deliveryFeeCents')::integer, (v_cart ->> 'serviceFeeCents')::integer,
    (v_cart ->> 'techFeeCents')::integer, (v_cart ->> 'totalCents')::integer,
    (v_cart ->> 'currency')::char(3), v_s.provider, p_payment_intent_id, p_charge_id,
    coalesce(p_application_fee_cents, 0), ts.estimated_prep_time_mins,
    now() + make_interval(mins => ts.estimated_prep_time_mins)
  from public.tenant_settings ts
  where ts.tenant_id = v_s.tenant_id
  returning id into v_order_id;

  -- ---- line items ---------------------------------------------------
  for v_line in select jsonb_array_elements(v_cart -> 'lines')
  loop
    insert into public.order_items (
      tenant_id, order_id, menu_item_id, name_snapshot,
      unit_price_cents, quantity, modifiers_total_cents, line_total_cents,
      notes, sort_order
    ) values (
      v_s.tenant_id, v_order_id, (v_line ->> 'menuItemId')::uuid, v_line ->> 'name',
      (v_line ->> 'unitPriceCents')::integer, (v_line ->> 'quantity')::integer,
      (v_line ->> 'modifiersTotalCents')::integer, (v_line ->> 'lineTotalCents')::integer,
      nullif(v_line ->> 'notes', ''), v_sort
    )
    returning id into v_item_id;

    if jsonb_typeof(v_line -> 'modifiers') = 'array' then
      for v_mod in select jsonb_array_elements(v_line -> 'modifiers')
      loop
        insert into public.order_item_modifiers (
          tenant_id, order_item_id, modifier_id, group_name_snapshot,
          name_snapshot, price_delta_cents, quantity
        ) values (
          v_s.tenant_id, v_item_id, (v_mod ->> 'modifierId')::uuid,
          v_mod ->> 'groupName', v_mod ->> 'name',
          (v_mod ->> 'priceDeltaCents')::integer, (v_mod ->> 'quantity')::integer
        );
      end loop;
    end if;

    v_sort := v_sort + 1;
  end loop;

  -- ---- dispatch row -------------------------------------------------
  -- Created unassigned. The courier proxy fills in external_ref; nothing
  -- provider-specific is ever written to public.orders.
  if v_s.fulfillment_type = 'delivery' then
    insert into public.deliveries (tenant_id, order_id, status)
    values (v_s.tenant_id, v_order_id, 'unassigned')
    on conflict (order_id) do nothing;
  end if;

  -- ---- outbound events (GoHighLevel) --------------------------------
  insert into public.webhook_events (tenant_id, event_type, order_id, payload)
  values (
    v_s.tenant_id, 'order.created', v_order_id,
    jsonb_build_object(
      'orderId', v_order_id, 'tenantId', v_s.tenant_id,
      'tenantName', v_tenant.name, 'totalCents', (v_cart ->> 'totalCents')::integer,
      'currency', v_cart ->> 'currency', 'fulfillmentType', v_s.fulfillment_type,
      'isFirstTimeCustomer', v_first_time,
      'contact', jsonb_build_object(
        'name', v_s.customer_name, 'phone', v_s.customer_phone, 'email', v_s.customer_email
      )
    )
  )
  on conflict (order_id, event_type) where order_id is not null do nothing;

  if v_first_time then
    insert into public.webhook_events (tenant_id, event_type, order_id, payload)
    values (
      v_s.tenant_id, 'order.first_time_customer', v_order_id,
      jsonb_build_object(
        'orderId', v_order_id, 'tenantId', v_s.tenant_id,
        'tenantName', v_tenant.name,
        'contact', jsonb_build_object(
          'name', v_s.customer_name, 'phone', v_s.customer_phone, 'email', v_s.customer_email
        )
      )
    )
    on conflict (order_id, event_type) where order_id is not null do nothing;
  end if;

  update public.checkout_sessions
     set status = 'completed',
         order_id = v_order_id,
         completed_at = now(),
         provider_payment_intent_id = coalesce(p_payment_intent_id, provider_payment_intent_id)
   where id = p_session_id;

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- record_dispatch_reference()
--
-- Called by the courier Edge Function after the provider accepts a job.
-- Keeps the provider's identifier in public.deliveries, which no client
-- role selects, instead of on public.orders, which customers can read.
-- ---------------------------------------------------------------------
create or replace function public.record_dispatch_reference(
  p_order_id              uuid,
  p_external_ref          text,
  p_status                public.delivery_status default 'unassigned',
  p_estimated_pickup_at   timestamptz default null,
  p_estimated_delivery_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.deliveries
     set external_ref = p_external_ref,
         status = p_status,
         estimated_pickup_at = coalesce(p_estimated_pickup_at, estimated_pickup_at),
         estimated_delivery_at = coalesce(p_estimated_delivery_at, estimated_delivery_at),
         assigned_at = case when p_status <> 'unassigned' then coalesce(assigned_at, now()) else assigned_at end
   where order_id = p_order_id;

  if not found then
    raise exception 'No delivery record for order %', p_order_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants
-- price_cart / open_checkout_session are the customer's entry points.
-- create_order_from_checkout and record_dispatch_reference are NOT granted
-- to any client role: service_role only, from verified webhooks.
-- ---------------------------------------------------------------------
revoke all on function public.price_cart(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.open_checkout_session(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_order_from_checkout(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.record_dispatch_reference(uuid, text, public.delivery_status, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.price_cart(uuid, jsonb) to anon, authenticated;
grant execute on function public.open_checkout_session(uuid, jsonb, jsonb, jsonb) to authenticated;
