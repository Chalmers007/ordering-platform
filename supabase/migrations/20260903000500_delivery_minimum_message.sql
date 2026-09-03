-- =====================================================================
-- 20260903000500_delivery_minimum_message.sql
--
-- The delivery-minimum error reaches the customer verbatim -- the cart
-- drawer renders whatever price_cart() raises. It formatted the shortfall
-- as raw cents:
--
--   "Delivery orders have a minimum of 15.00 -- add 100 more"
--
-- which reads as "add another hundred dollars" to anyone not looking at
-- the schema. Both figures are money now.
--
-- Replaced whole rather than patched, because a function body cannot be
-- edited in place.
-- =====================================================================

set check_function_bodies = off;

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
    -- Both figures as money: this string is shown to the customer verbatim.
    raise exception 'Delivery orders have a minimum of $%. Add $% more to continue.',
      to_char(v_settings.delivery_minimum_cents / 100.0, 'FM999999990.00'),
      to_char((v_settings.delivery_minimum_cents - v_subtotal) / 100.0, 'FM999999990.00')
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

