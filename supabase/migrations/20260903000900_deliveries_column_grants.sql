-- ---------------------------------------------------------------------
-- Stop naming the courier to the customer.
--
-- `deliveries` carried a whole-table SELECT grant to `authenticated`,
-- written when the table held only ids and timestamps. Later migrations
-- added `provider` and `tracking_url`, and a table-level grant covers
-- every column a table will ever have — so both were exposed the moment
-- they existed, with no line of any migration saying so.
--
-- The RLS policy on this table deliberately lets a customer read their
-- OWN delivery row, so the tracking page can react to it over Realtime:
--
--   deliveries_select:  has_tenant_access(tenant_id)
--                       OR EXISTS (select 1 from orders o
--                                  where o.id = deliveries.order_id
--                                    and o.customer_user_id = auth.uid())
--
-- Combined, a signed-in customer could read:
--
--   provider       'uber_direct'  -- names the courier network
--   external_ref   the courier's job id
--   tracking_url   a link on the courier's own domain
--   cost_cents     what the PLATFORM pays the courier, not what the
--                  customer paid — a margin, visible to the customer and
--                  to the restaurant
--   failure_reason internal error text
--   courier_*      name, phone, photo, live coordinates
--
-- The whole point of routing customers through get_delivery_tracking() is
-- that they receive a white-labelled payload. A direct table read went
-- around it.
--
-- Fixed by grant, not by policy: RLS decides which ROWS a caller sees and
-- cannot express "these columns, never". Column-level grants can, and
-- they fail safe — a column added tomorrow is NOT covered by a
-- column-level grant, where a table-level grant would swallow it silently
-- exactly as this one did.
--
-- Nothing in the application reads these columns as `authenticated`:
-- every server-side read uses the service role, and the storefront
-- tracking view uses its Realtime subscription only as a signal to
-- refetch through get_delivery_tracking().
-- ---------------------------------------------------------------------

revoke select on public.deliveries from authenticated;

-- Only what a client needs to notice that something changed. Everything a
-- customer is meant to SEE arrives via get_delivery_tracking(), which is
-- where the white-labelling lives.
grant select (
  id,
  order_id,
  tenant_id,
  status,
  updated_at
) on public.deliveries to authenticated;

-- Guard the bug class. If someone re-grants the whole table — the easiest
-- mistake to make, and the one that caused this — the count of readable
-- columns jumps and the deploy fails here rather than leaking quietly.
do $$
declare
  v_leaked text;
begin
  select string_agg(c.column_name, ', ' order by c.column_name)
    into v_leaked
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'deliveries'
    and c.column_name not in ('id', 'order_id', 'tenant_id', 'status', 'updated_at')
    and has_column_privilege('authenticated', 'public.deliveries', c.column_name, 'select');

  if v_leaked is not null then
    raise exception
      'deliveries exposes % to authenticated. Grant columns explicitly; a table-level grant covers every column the table will ever have.',
      v_leaked;
  end if;
end $$;
