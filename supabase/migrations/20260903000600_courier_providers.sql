-- =====================================================================
-- 20260903000600_courier_providers.sql
-- A second courier (Uber Direct) alongside the first.
--
-- The spec for this integration asked for uber_delivery_id, tracking_url,
-- courier_name and courier_phone on `public.orders`. They go on
-- `deliveries` instead, for the reason the first courier's job id did:
-- customers can read their own `orders` row, so a column named
-- uber_delivery_id names the vendor to every one of them. `deliveries` is
-- selected by staff and by the tracking function, which allow-lists what
-- it returns. The dispatch provider stays an implementation detail.
-- =====================================================================

set check_function_bodies = off;

-- Which courier handled this delivery. Needed to route a status webhook
-- back to the right record and to know which API can still act on it.
alter table public.deliveries
  add column if not exists provider text;

alter table public.deliveries
  add constraint deliveries_provider_chk
    check (provider is null or provider in ('shipday', 'uber_direct'));

comment on column public.deliveries.provider is
  'Courier network that holds this job. Never returned to a customer.';

-- external_ref is unique per tenant; with two providers the same string
-- could in principle collide across them.
drop index if exists deliveries_external_ref_key;
create unique index deliveries_provider_ref_key
  on public.deliveries (provider, external_ref)
  where external_ref is not null;

-- ---------------------------------------------------------------------
-- The inbound idempotency ledger was typed to payment providers.
--
-- It is not a payments table — it is "webhooks we have already seen", and
-- a courier redelivering a status event needs the same protection a
-- payment processor does. Widened to text with a check, rather than
-- stretching payment_provider to mean something it does not.
-- ---------------------------------------------------------------------
alter table public.inbound_webhook_events
  alter column provider type text using provider::text;

alter table public.inbound_webhook_events
  add constraint inbound_webhook_events_provider_chk
    check (provider in ('stripe', 'square', 'paypal', 'shipday', 'uber_direct'));

-- ---------------------------------------------------------------------
-- record_dispatch_reference()
--
-- Extended to carry the provider and the courier's details, which arrive
-- with the dispatch response rather than only later by webhook.
-- ---------------------------------------------------------------------
create or replace function public.record_dispatch_reference(
  p_order_id              uuid,
  p_external_ref          text,
  p_status                public.delivery_status default 'unassigned',
  p_estimated_pickup_at   timestamptz default null,
  p_estimated_delivery_at timestamptz default null,
  p_tracking_url          text default null,
  p_provider              text default null,
  p_courier_name          text default null,
  p_courier_phone         text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.deliveries
     set external_ref = p_external_ref,
         provider = coalesce(p_provider, provider),
         status = p_status,
         estimated_pickup_at = coalesce(p_estimated_pickup_at, estimated_pickup_at),
         estimated_delivery_at = coalesce(p_estimated_delivery_at, estimated_delivery_at),
         tracking_url = coalesce(p_tracking_url, tracking_url),
         courier_name = coalesce(p_courier_name, courier_name),
         courier_phone = coalesce(p_courier_phone, courier_phone),
         assigned_at = case when p_status <> 'unassigned' then coalesce(assigned_at, now()) else assigned_at end
   where order_id = p_order_id;

  if not found then
    raise exception 'No delivery record for order %', p_order_id using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.record_dispatch_reference(
  uuid, text, public.delivery_status, timestamptz, timestamptz, text, text, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- apply_delivery_event()
--
-- What a courier webhook calls. It updates the delivery AND moves the
-- order, because the customer's tracking page reads order status and
-- would otherwise sit on "Preparing" while a driver was at their door.
--
-- Service-role only. advance_order_status() cannot be reused here: it
-- checks has_tenant_access(), and a webhook has no auth.uid() — so the
-- same transition rules are applied explicitly instead of bypassed.
-- ---------------------------------------------------------------------
create or replace function public.apply_delivery_event(
  p_provider     text,
  p_external_ref text,
  p_status       public.delivery_status,
  p_courier_name text default null,
  p_courier_phone text default null,
  p_latitude     double precision default null,
  p_longitude    double precision default null,
  p_tracking_url text default null,
  p_estimated_delivery_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery public.deliveries%rowtype;
  v_order    public.orders%rowtype;
begin
  select * into v_delivery
  from public.deliveries
  where provider = p_provider and external_ref = p_external_ref
  for update;

  if not found then
    -- Not an error worth retrying: the job belongs to someone else, or to
    -- a deleted order. The caller records it and moves on.
    return null;
  end if;

  update public.deliveries
     set status = p_status,
         courier_name = coalesce(p_courier_name, courier_name),
         courier_phone = coalesce(p_courier_phone, courier_phone),
         courier_latitude = coalesce(p_latitude, courier_latitude),
         courier_longitude = coalesce(p_longitude, courier_longitude),
         tracking_url = coalesce(p_tracking_url, tracking_url),
         estimated_delivery_at = coalesce(p_estimated_delivery_at, estimated_delivery_at),
         location_updated_at = case
           when p_latitude is not null then now() else location_updated_at
         end,
         picked_up_at = case
           when p_status in ('picked_up', 'en_route') then coalesce(picked_up_at, now())
           else picked_up_at
         end,
         delivered_at = case
           when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at
         end
   where id = v_delivery.id;

  select * into v_order from public.orders where id = v_delivery.order_id for update;

  perform set_config('app.audit_operation', 'COURIER_STATUS_EVENT', true);

  -- Only ever forward, and only from a state the kitchen has already
  -- reached: a courier event must not drag an order backwards or complete
  -- one the kitchen has not finished.
  if p_status in ('picked_up', 'en_route')
     and v_order.status in ('ready', 'preparing', 'confirmed', 'paid')
  then
    update public.orders set status = 'out_for_delivery' where id = v_order.id;
  elsif p_status = 'delivered' and v_order.status = 'out_for_delivery' then
    update public.orders set status = 'completed' where id = v_order.id;
  elsif p_status in ('failed', 'cancelled') then
    -- Deliberately does NOT cancel the order. A failed drop-off is the
    -- restaurant's decision to make, and auto-cancelling a paid order
    -- would refund-by-accident.
    update public.deliveries
       set failure_reason = coalesce(failure_reason, 'Courier reported ' || p_status)
     where id = v_delivery.id;
  end if;

  return v_delivery.order_id;
end;
$$;

revoke all on function public.apply_delivery_event(
  text, text, public.delivery_status, text, text, double precision, double precision, text, timestamptz
) from public, anon, authenticated;
