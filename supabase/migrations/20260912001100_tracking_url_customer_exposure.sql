-- =====================================================================
-- 20260912001100_tracking_url_customer_exposure.sql
-- Remove courier_tracking_url from customer-facing RPC.
--
-- The get_delivery_tracking() RPC is callable by `anon` and `authenticated`
-- users and was returning courier_tracking_url (line 59, 101 of
-- 20260903000400). This exposes provider URLs to customers even when the
-- API layer filters them — a sophisticated customer could call the RPC
-- directly via Supabase.
--
-- The column still exists on the table for internal use and provider
-- integration, but the RPC no longer exposes it to customers.
--
-- Safe: our TypeScript code (TrackingRow type) already expects this field
-- to be absent from RPC responses. The tracking API never included it in
-- customer responses. This migration aligns the database with the
-- application's actual threat model.
-- =====================================================================

set check_function_bodies = off;

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
  subtotal_cents        integer,
  discount_cents        integer,
  tax_cents             integer,
  tip_cents             integer,
  delivery_fee_cents    integer,
  service_fee_cents     integer,
  tech_fee_cents        integer,
  total_cents           integer,
  currency              char(3),
  items                 jsonb,
  delivery_status       public.delivery_status,
  driver_name           text,
  driver_phone          text,
  latitude              double precision,
  longitude             double precision,
  heading               double precision,
  location_updated_at   timestamptz,
  estimated_delivery_at timestamptz,
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
    d.location_updated_at, d.estimated_delivery_at,
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
