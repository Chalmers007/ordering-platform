-- =====================================================================
-- 20260905000100_fix_create_order_direct_ambiguity.sql
--
-- create_order_direct() raised
--   "column reference \"tracking_token\" is ambiguous"
-- for every call, so /api/orders/create returned 500 and NO order could
-- be placed at all — which is why production holds zero orders.
--
-- The function RETURNS TABLE (order_id uuid, tracking_token uuid). Those
-- output columns are in scope for the whole body, so the bare
-- `tracking_token` in the INSERT column list, and the bare `order_id` in
-- the webhook_events ON CONFLICT target, each match both an output
-- column and a table column.
--
-- `#variable_conflict use_column` resolves such a name to the column,
-- which is what both sites mean. It is safe for the rest of the body
-- because every genuine local is v_-prefixed and every argument is
-- p_-prefixed, so no other name is ambiguous.
--
-- Recreated rather than edited in place: 20260903001000 is already
-- applied to production.
-- =====================================================================

create or replace function public.create_order_direct(
  p_tenant_id               uuid,
  p_priced_cart             jsonb,
  p_customer_name           text,
  p_customer_phone          text,
  p_customer_email          text default null,
  p_fulfillment_type        public.fulfillment_type default 'delivery',
  p_delivery_address_line1  text default null,
  p_delivery_address_line2  text default null,
  p_delivery_city           text default null,
  p_delivery_region         text default null,
  p_delivery_postal_code    text default null,
  p_delivery_country        char(2) default 'US',
  p_delivery_latitude       double precision default null,
  p_delivery_longitude      double precision default null,
  p_delivery_instructions   text default null
)
returns table (order_id uuid, tracking_token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_order_id              uuid;
  v_tracking              uuid;
  v_cart                  jsonb;
  v_line                  jsonb;
  v_mod                   jsonb;
  v_item_id               uuid;
  v_first_time            boolean;
  v_sort                  integer := 0;
  v_tenant                public.tenants%rowtype;
  v_settings              public.tenant_settings%rowtype;
  v_prep_time             integer;
  v_new_tracking_token    uuid;
  v_lines                 jsonb;
  v_idx                   integer;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found or v_tenant.status <> 'active' then
    raise exception 'This restaurant is not accepting orders' using errcode = 'check_violation';
  end if;

  select * into v_settings from public.tenant_settings where tenant_id = p_tenant_id;
  if not found then
    raise exception 'Restaurant is not configured' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_priced_cart) <> 'object' then
    raise exception 'Invalid priced cart' using errcode = 'check_violation';
  end if;

  v_cart := p_priced_cart;

  if p_fulfillment_type = 'delivery'
     and (p_delivery_address_line1 is null or p_delivery_city is null or p_delivery_postal_code is null)
  then
    raise exception 'Delivery orders require a complete address' using errcode = 'check_violation';
  end if;

  -- First-time customer is decided by prior *placed* orders on this
  -- tenant for this phone number, before the new row exists.
  select not exists (
    select 1 from public.orders
    where tenant_id = p_tenant_id
      and customer_phone = p_customer_phone
      and status <> 'draft'
  ) into v_first_time;

  v_new_tracking_token := gen_random_uuid();
  v_prep_time := v_settings.estimated_prep_time_mins;

  insert into public.orders (
    tenant_id, status, payment_status, fulfillment_type,
    customer_name, customer_phone, customer_email,
    is_first_time_customer, tracking_token,
    delivery_address_line1, delivery_address_line2, delivery_city,
    delivery_region, delivery_postal_code, delivery_country,
    delivery_latitude, delivery_longitude, delivery_instructions,
    subtotal_cents, discount_cents, tax_cents, tip_cents,
    delivery_fee_cents, service_fee_cents, tech_fee_cents, total_cents,
    currency, prep_time_mins, promised_at
  )
  values (
    p_tenant_id, 'paid', 'paid', p_fulfillment_type,
    btrim(p_customer_name), btrim(p_customer_phone),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    v_first_time, v_new_tracking_token,
    p_delivery_address_line1, p_delivery_address_line2, p_delivery_city,
    p_delivery_region, p_delivery_postal_code, p_delivery_country,
    p_delivery_latitude, p_delivery_longitude, p_delivery_instructions,
    (v_cart ->> 'subtotalCents')::integer, (v_cart ->> 'discountCents')::integer,
    (v_cart ->> 'taxCents')::integer, (v_cart ->> 'tipCents')::integer,
    (v_cart ->> 'deliveryFeeCents')::integer, (v_cart ->> 'serviceFeeCents')::integer,
    (v_cart ->> 'techFeeCents')::integer, (v_cart ->> 'totalCents')::integer,
    (v_cart ->> 'currency')::char(3), v_prep_time,
    now() + make_interval(mins => v_prep_time)
  )
  returning id into v_order_id;

  v_tracking := v_new_tracking_token;

  if v_order_id is null then
    raise exception 'Failed to create order' using errcode = 'internal_error';
  end if;

  -- ---- line items ---------------------------------------------------
  v_lines := v_cart -> 'lines';
  for v_idx in 0..(jsonb_array_length(v_lines) - 1)
  loop
    v_line := v_lines -> v_idx;

    insert into public.order_items (
      tenant_id, order_id, menu_item_id, name_snapshot,
      unit_price_cents, quantity, modifiers_total_cents, line_total_cents,
      notes, sort_order
    ) values (
      p_tenant_id, v_order_id, (v_line ->> 'menuItemId')::uuid, v_line ->> 'name',
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
          p_tenant_id, v_item_id, (v_mod ->> 'modifierId')::uuid,
          v_mod ->> 'groupName', v_mod ->> 'name',
          (v_mod ->> 'priceDeltaCents')::integer, (v_mod ->> 'quantity')::integer
        );
      end loop;
    end if;

    v_sort := v_sort + 1;
  end loop;

  -- ---- delivery row -------------------------------------------------
  -- Created unassigned. The auto-dispatch handler fills in external_ref.
  if p_fulfillment_type = 'delivery' then
    insert into public.deliveries (tenant_id, order_id, status)
    values (p_tenant_id, v_order_id, 'unassigned')
    on conflict (order_id) do nothing;
  end if;

  -- ---- outbound events (GoHighLevel) --------------------------------
  insert into public.webhook_events (tenant_id, event_type, order_id, payload)
  values (
    p_tenant_id, 'order.created', v_order_id,
    jsonb_build_object(
      'orderId', v_order_id, 'tenantId', p_tenant_id,
      'tenantName', v_tenant.name, 'totalCents', (v_cart ->> 'totalCents')::integer,
      'currency', v_cart ->> 'currency', 'fulfillmentType', p_fulfillment_type,
      'isFirstTimeCustomer', v_first_time,
      'contact', jsonb_build_object(
        'name', p_customer_name, 'phone', p_customer_phone, 'email', p_customer_email
      )
    )
  )
  on conflict (order_id, event_type) where order_id is not null do nothing;

  if v_first_time then
    insert into public.webhook_events (tenant_id, event_type, order_id, payload)
    values (
      p_tenant_id, 'order.first_time_customer', v_order_id,
      jsonb_build_object(
        'orderId', v_order_id, 'tenantId', p_tenant_id,
        'tenantName', v_tenant.name,
        'contact', jsonb_build_object(
          'name', p_customer_name, 'phone', p_customer_phone, 'email', p_customer_email
        )
      )
    )
    on conflict (order_id, event_type) where order_id is not null do nothing;
  end if;

  return query select v_order_id, v_tracking;
end;
$$;
