-- =====================================================================
-- 20260903000400_order_tracking.sql
-- What the customer sees while they wait: the order itself, not just
-- where the driver is.
--
-- get_delivery_tracking() returned movement but no order — no items, no
-- total — so the tracking page could show a map and a progress bar while
-- being unable to answer "what did I order and what did I pay?".
-- =====================================================================

set check_function_bodies = off;

-- A courier-hosted tracking page, when the provider offers one.
alter table public.deliveries
  add column if not exists tracking_url text;

comment on column public.deliveries.tracking_url is
  'Courier-hosted tracking page, when the provider offers one. NOTE: surfacing this to a customer reveals the courier brand, which the rest of the dispatch path deliberately hides — the built-in map is the white-labelled alternative.';

-- Return type changes, so the old signature has to go first.
drop function if exists public.get_delivery_tracking(uuid, uuid);

create or replace function public.get_delivery_tracking(
  p_order_id uuid default null,
  p_token    uuid default null
)
returns table (
  order_id              uuid,
  tenant_id             uuid,
  order_number          text,
  order_status          public.order_status,
  fulfillment_type      public.fulfillment_type,
  promised_at           timestamptz,
  placed_at             timestamptz,
  completed_at          timestamptz,
  customer_name         text,
  -- Money the customer already agreed to. Safe to show them their own
  -- receipt; still no payment identifiers.
  subtotal_cents        integer,
  discount_cents        integer,
  tax_cents             integer,
  tip_cents             integer,
  delivery_fee_cents    integer,
  service_fee_cents     integer,
  tech_fee_cents        integer,
  total_cents           integer,
  currency              char(3),
  -- The order as ordered, from the snapshot taken at checkout, so a later
  -- menu edit cannot rewrite what someone is looking at.
  items                 jsonb,
  delivery_status       public.delivery_status,
  driver_name           text,
  driver_phone          text,
  latitude              double precision,
  longitude             double precision,
  heading               double precision,
  location_updated_at   timestamptz,
  estimated_delivery_at timestamptz,
  courier_tracking_url  text,
  -- Internal: lets the API decide whether to refresh from the courier.
  -- Never serialised into a client response.
  has_external_ref      boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.id, o.tenant_id, o.order_number, o.status, o.fulfillment_type,
    o.promised_at, o.placed_at, o.completed_at, o.customer_name,
    o.subtotal_cents, o.discount_cents, o.tax_cents, o.tip_cents,
    o.delivery_fee_cents, o.service_fee_cents, o.tech_fee_cents,
    o.total_cents, o.currency,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', oi.name_snapshot,
            'quantity', oi.quantity,
            'lineTotalCents', oi.line_total_cents,
            'notes', oi.notes,
            'modifiers', coalesce(
              (
                select jsonb_agg(m.name_snapshot order by m.created_at)
                from public.order_item_modifiers m
                where m.order_item_id = oi.id
              ),
              '[]'::jsonb
            )
          )
          order by oi.sort_order, oi.id
        )
        from public.order_items oi
        where oi.order_id = o.id
      ),
      '[]'::jsonb
    ),
    d.status, d.courier_name, d.courier_phone,
    d.courier_latitude, d.courier_longitude, d.courier_heading,
    d.location_updated_at, d.estimated_delivery_at, d.tracking_url,
    d.external_ref is not null
  from public.orders o
  left join public.deliveries d on d.order_id = o.id
  where o.status <> 'draft'
    and (
      (p_order_id is not null and o.id = p_order_id
        and (o.customer_user_id = auth.uid() or public.has_tenant_access(o.tenant_id)))
      or
      (p_token is not null and o.tracking_token = p_token
        and o.created_at > now() - interval '30 days')
    );
$$;

revoke all on function public.get_delivery_tracking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_delivery_tracking(uuid, uuid) to anon, authenticated;

-- The courier proxy writes this alongside the rest of the dispatch state.
create or replace function public.record_dispatch_reference(
  p_order_id              uuid,
  p_external_ref          text,
  p_status                public.delivery_status default 'unassigned',
  p_estimated_pickup_at   timestamptz default null,
  p_estimated_delivery_at timestamptz default null,
  p_tracking_url          text default null
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
         tracking_url = coalesce(p_tracking_url, tracking_url),
         assigned_at = case when p_status <> 'unassigned' then coalesce(assigned_at, now()) else assigned_at end
   where order_id = p_order_id;

  if not found then
    raise exception 'No delivery record for order %', p_order_id using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.record_dispatch_reference(uuid, text, public.delivery_status, timestamptz, timestamptz, text)
  from public, anon, authenticated;
