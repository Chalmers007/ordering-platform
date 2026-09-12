-- Standalone ordering can receive an unpaid order without mislabelling it paid.
alter type public.order_status add value if not exists 'received' before 'paid';

create or replace function public.advance_order_status(
  p_order_id uuid,
  p_to_status public.order_status,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_allowed public.order_status[];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Unknown order %', p_order_id using errcode = 'no_data_found'; end if;
  if not public.has_tenant_access(v_order.tenant_id) then raise exception 'You do not have access to this order' using errcode = 'insufficient_privilege'; end if;
  v_allowed := case v_order.status
    when 'received' then array['confirmed','cancelled']::public.order_status[]
    when 'paid' then array['confirmed','preparing','cancelled']::public.order_status[]
    when 'confirmed' then array['preparing','cancelled']::public.order_status[]
    when 'preparing' then array['ready','cancelled']::public.order_status[]
    when 'ready' then case when v_order.fulfillment_type = 'delivery' then array['out_for_delivery','completed','cancelled']::public.order_status[] else array['completed','cancelled']::public.order_status[] end
    when 'out_for_delivery' then array['completed','cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end;
  if not (p_to_status = any(v_allowed)) then raise exception 'An order that is % cannot become %', v_order.status, p_to_status using errcode = 'check_violation'; end if;
  update public.orders set status=p_to_status, cancellation_reason=case when p_to_status='cancelled' then nullif(btrim(coalesce(p_note,'')),'') else cancellation_reason end where id=p_order_id returning * into v_order;
  if p_note is not null and btrim(p_note) <> '' then update public.order_status_events set note=btrim(p_note) where id=(select id from public.order_status_events where order_id=p_order_id order by created_at desc,id desc limit 1); end if;
  return v_order;
end;
$$;
