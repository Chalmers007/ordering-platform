-- =====================================================================
-- 20260902090200_orders.sql
-- Orders, line items, status history, dispatch, outbound webhook outbox.
-- =====================================================================

set check_function_bodies = off;

create type public.fulfillment_type as enum ('delivery', 'pickup');

create type public.order_status as enum (
  'draft',            -- cart persisted, not submitted
  'pending_payment',  -- payment intent created, awaiting confirmation
  'paid',             -- funds captured/authorised; not yet acknowledged by the kitchen
  'confirmed',        -- kitchen accepted
  'preparing',
  'ready',            -- ready for pickup / awaiting courier
  'out_for_delivery',
  'completed',
  'cancelled',
  'refunded'
);

create type public.payment_status as enum (
  'unpaid', 'processing', 'authorized', 'paid', 'failed',
  'refunded', 'partially_refunded'
);

create type public.delivery_status as enum (
  'unassigned', 'assigned', 'picked_up', 'en_route', 'delivered', 'failed', 'cancelled'
);

create type public.webhook_event_type as enum (
  'order.created', 'order.first_time_customer', 'order.completed',
  'order.cancelled', 'order.refunded'
);

create type public.webhook_delivery_status as enum (
  'pending', 'delivering', 'delivered', 'failed', 'abandoned'
);

-- ---------------------------------------------------------------------
-- Per-tenant order numbering
-- ---------------------------------------------------------------------
create table public.tenant_order_counters (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  last_number bigint not null default 0
);

-- ---------------------------------------------------------------------
-- orders
--
-- Money invariant is enforced by the database, not by the checkout code:
--   total = subtotal - discount + tax + tip + delivery + service + tech
-- ---------------------------------------------------------------------
create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  order_number          text not null,

  -- Opaque token so a guest can track an order without an account.
  tracking_token        uuid not null default gen_random_uuid(),

  status                public.order_status not null default 'draft',
  payment_status        public.payment_status not null default 'unpaid',
  fulfillment_type      public.fulfillment_type not null default 'delivery',

  -- Customer. customer_user_id is null for a guest who never registered.
  customer_user_id      uuid references auth.users(id) on delete set null,
  customer_name         text not null,
  customer_phone        text not null,
  customer_email        text,
  is_first_time_customer boolean not null default false,

  -- Delivery destination (null for pickup)
  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_city          text,
  delivery_region        text,
  delivery_postal_code   text,
  delivery_country       char(2) default 'US',
  delivery_latitude      double precision,
  delivery_longitude     double precision,
  delivery_instructions  text,

  -- Money, integer cents
  subtotal_cents        integer not null default 0,
  discount_cents        integer not null default 0,
  tax_cents             integer not null default 0,
  tip_cents             integer not null default 0,
  delivery_fee_cents    integer not null default 0,
  service_fee_cents     integer not null default 0,
  tech_fee_cents        integer not null default 0,
  total_cents           integer not null default 0,
  currency              char(3) not null default 'USD',

  -- Payment linkage
  payment_provider      public.payment_provider,
  payment_intent_id     text,
  payment_charge_id     text,
  -- What actually routed to the platform account (Stripe application_fee_amount)
  application_fee_cents integer not null default 0,
  refunded_cents        integer not null default 0,

  -- Kitchen
  prep_time_mins        integer,
  promised_at           timestamptz,
  accepted_at           timestamptz,
  ready_at              timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,

  notes                 text,
  placed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint orders_money_nonneg_chk check (
    subtotal_cents >= 0 and discount_cents >= 0 and tax_cents >= 0 and
    tip_cents >= 0 and delivery_fee_cents >= 0 and service_fee_cents >= 0 and
    tech_fee_cents >= 0 and total_cents >= 0 and application_fee_cents >= 0 and
    refunded_cents >= 0
  ),
  constraint orders_total_chk check (
    total_cents = subtotal_cents - discount_cents + tax_cents + tip_cents
                  + delivery_fee_cents + service_fee_cents + tech_fee_cents
  ),
  constraint orders_discount_chk check (discount_cents <= subtotal_cents),
  constraint orders_refund_chk   check (refunded_cents <= total_cents),
  constraint orders_tech_fee_chk check (tech_fee_cents between 0 and 1000),
  constraint orders_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint orders_phone_chk    check (length(btrim(customer_phone)) >= 7),
  -- A delivery order must have somewhere to go once it leaves draft.
  constraint orders_delivery_address_chk check (
    fulfillment_type <> 'delivery'
    or status = 'draft'
    or (delivery_address_line1 is not null and delivery_city is not null
        and delivery_postal_code is not null)
  ),
  -- Cancellation must be stamped. (Not an iff: a cancelled order can later
  -- be marked refunded and keeps its cancelled_at.)
  constraint orders_cancel_chk check (
    status <> 'cancelled' or cancelled_at is not null
  )
);

create unique index orders_tenant_number_key on public.orders (tenant_id, order_number);
create unique index orders_tracking_token_key on public.orders (tracking_token);
create index orders_tenant_created_idx on public.orders (tenant_id, created_at desc);
create index orders_tenant_status_idx  on public.orders (tenant_id, status, created_at desc);
create index orders_customer_idx       on public.orders (customer_user_id, created_at desc)
  where customer_user_id is not null;
create index orders_tenant_phone_idx   on public.orders (tenant_id, customer_phone);
create unique index orders_payment_intent_key
  on public.orders (payment_provider, payment_intent_id)
  where payment_intent_id is not null;
-- KDS board query: everything the kitchen still owns.
create index orders_kds_open_idx on public.orders (tenant_id, created_at)
  where status in ('paid', 'confirmed', 'preparing', 'ready', 'out_for_delivery');
create unique index orders_id_tenant_key on public.orders (id, tenant_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.fn_set_updated_at();

-- Sequential, human-readable, per-tenant order numbers. Atomic under
-- concurrency because the counter row is updated in the same statement.
create or replace function public.fn_orders_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next bigint;
begin
  if new.order_number is not null and length(btrim(new.order_number)) > 0 then
    return new;
  end if;

  insert into public.tenant_order_counters (tenant_id, last_number)
  values (new.tenant_id, 1)
  on conflict (tenant_id)
    do update set last_number = public.tenant_order_counters.last_number + 1
  returning last_number into v_next;

  new.order_number := to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.fn_orders_assign_number();

-- Stamp lifecycle timestamps from the status transition itself so no
-- caller can forget one.
create or replace function public.fn_orders_stamp_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 'confirmed'  then new.accepted_at  := coalesce(new.accepted_at, now());
      when 'ready'      then new.ready_at     := coalesce(new.ready_at, now());
      when 'completed'  then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled'  then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;

  if new.status <> 'draft' and new.placed_at is null then
    new.placed_at := now();
  end if;

  return new;
end;
$$;

create trigger orders_stamp_lifecycle
  before insert or update on public.orders
  for each row execute function public.fn_orders_stamp_lifecycle();

-- ---------------------------------------------------------------------
-- order_items
-- Line items snapshot name and price. A later menu edit must never
-- rewrite the history of an order that was already paid for.
-- ---------------------------------------------------------------------
create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  order_id           uuid not null,
  menu_item_id       uuid references public.menu_items(id) on delete set null,

  name_snapshot      text not null,
  unit_price_cents   integer not null,
  quantity           integer not null,
  modifiers_total_cents integer not null default 0,
  line_total_cents   integer not null,
  notes              text,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),

  constraint order_items_qty_chk   check (quantity between 1 and 999),
  constraint order_items_price_chk check (unit_price_cents >= 0),
  constraint order_items_total_chk
    check (line_total_cents = (unit_price_cents + modifiers_total_cents) * quantity),
  constraint order_items_order_fk
    foreign key (order_id, tenant_id)
    references public.orders (id, tenant_id) on delete cascade
);

create index order_items_order_idx on public.order_items (order_id, sort_order, id);
create index order_items_tenant_item_idx on public.order_items (tenant_id, menu_item_id);
create unique index order_items_id_tenant_key on public.order_items (id, tenant_id);

-- ---------------------------------------------------------------------
-- order_item_modifiers
-- ---------------------------------------------------------------------
create table public.order_item_modifiers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  order_item_id      uuid not null,
  modifier_id        uuid references public.menu_modifiers(id) on delete set null,
  group_name_snapshot text,
  name_snapshot      text not null,
  price_delta_cents  integer not null default 0,
  quantity           integer not null default 1,
  created_at         timestamptz not null default now(),

  constraint order_item_modifiers_qty_chk check (quantity between 1 and 99),
  constraint order_item_modifiers_item_fk
    foreign key (order_item_id, tenant_id)
    references public.order_items (id, tenant_id) on delete cascade
);

create index order_item_modifiers_item_idx on public.order_item_modifiers (order_item_id);
create index order_item_modifiers_tenant_idx on public.order_item_modifiers (tenant_id);

-- ---------------------------------------------------------------------
-- order_status_events
-- Append-only status history; powers the customer tracking timeline.
-- ---------------------------------------------------------------------
create table public.order_status_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  order_id     uuid not null,
  from_status  public.order_status,
  to_status    public.order_status not null,
  actor_id     uuid references auth.users(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),

  constraint order_status_events_order_fk
    foreign key (order_id, tenant_id)
    references public.orders (id, tenant_id) on delete cascade
);

create index order_status_events_order_idx
  on public.order_status_events (order_id, created_at);

create or replace function public.fn_orders_record_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (tenant_id, order_id, from_status, to_status, actor_id)
    values (new.tenant_id, new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_events (tenant_id, order_id, from_status, to_status, actor_id)
    values (new.tenant_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger orders_record_status_event
  after insert or update of status on public.orders
  for each row execute function public.fn_orders_record_status_event();

-- ---------------------------------------------------------------------
-- deliveries
-- Provider-agnostic dispatch record. The customer-facing tracking API
-- reads only from this table -- the courier provider is never named in
-- anything that reaches a browser.
-- ---------------------------------------------------------------------
create table public.deliveries (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  order_id            uuid not null,

  status              public.delivery_status not null default 'unassigned',
  -- Upstream dispatch id. Internal only; never selected into a client payload.
  external_ref        text,

  courier_name        text,
  courier_phone       text,
  courier_photo_url   text,
  courier_latitude    double precision,
  courier_longitude   double precision,
  courier_heading     double precision,
  location_updated_at timestamptz,

  estimated_pickup_at   timestamptz,
  estimated_delivery_at timestamptz,
  assigned_at         timestamptz,
  picked_up_at        timestamptz,
  delivered_at        timestamptz,
  failure_reason      text,

  distance_meters     integer,
  cost_cents          integer,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint deliveries_order_fk
    foreign key (order_id, tenant_id)
    references public.orders (id, tenant_id) on delete cascade,
  constraint deliveries_lat_chk
    check (courier_latitude is null or courier_latitude between -90 and 90),
  constraint deliveries_lng_chk
    check (courier_longitude is null or courier_longitude between -180 and 180)
);

create unique index deliveries_order_key on public.deliveries (order_id);
create index deliveries_tenant_status_idx on public.deliveries (tenant_id, status);
create unique index deliveries_external_ref_key
  on public.deliveries (tenant_id, external_ref) where external_ref is not null;

create trigger deliveries_set_updated_at
  before update on public.deliveries
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- webhook_events
-- Durable outbox for outbound GoHighLevel calls. Rows are enqueued inside
-- the same transaction that writes the order, then drained by an Edge
-- Function. Fire-and-forget HTTP from a request handler loses events.
-- ---------------------------------------------------------------------
create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  event_type    public.webhook_event_type not null,
  order_id      uuid references public.orders(id) on delete set null,
  payload       jsonb not null,
  status        public.webhook_delivery_status not null default 'pending',
  attempts      integer not null default 0,
  max_attempts  integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  last_error    text,
  response_status integer,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint webhook_events_payload_chk check (jsonb_typeof(payload) = 'object'),
  constraint webhook_events_attempts_chk check (attempts >= 0 and max_attempts > 0)
);

-- Drain query: the queue worker's only index.
create index webhook_events_queue_idx
  on public.webhook_events (next_attempt_at)
  where status in ('pending', 'delivering');
create index webhook_events_tenant_idx on public.webhook_events (tenant_id, created_at desc);
-- One delivery per (order, event type). Makes enqueue idempotent under retries.
create unique index webhook_events_order_type_key
  on public.webhook_events (order_id, event_type) where order_id is not null;

create trigger webhook_events_set_updated_at
  before update on public.webhook_events
  for each row execute function public.fn_set_updated_at();
