-- =====================================================================
-- 20260902090800_kds.sql
-- Kitchen Display System: semantic audit operations, validated order
-- state transitions, and the pacing controls the storefront reacts to.
-- =====================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------
-- audit_logs.operation
--
-- `action` is the DML verb and must stay that way -- it is what makes the
-- trail readable as a database history. But "the manager paused the
-- kitchen" is not the same fact as "a row in tenant_settings was
-- UPDATEd", and squeezing the first into the second loses the intent.
--
-- So: a nullable semantic label alongside the verb. Callers set it with a
-- transaction-local GUC and fn_audit_log() picks it up, which means any
-- future operation gets the same treatment without touching the trigger.
-- ---------------------------------------------------------------------
alter table public.audit_logs add column operation text;

create index audit_logs_operation_idx
  on public.audit_logs (tenant_id, operation, created_at desc)
  where operation is not null;

comment on column public.audit_logs.operation is
  'Semantic intent (TOGGLE_KITCHEN_PAUSE, ADVANCE_ORDER_STATUS, ...), set via the app.audit_operation GUC. `action` remains the DML verb.';

create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old          jsonb;
  v_new          jsonb;
  v_row          jsonb;
  v_tenant_id    uuid;
  v_record_id    uuid;
  v_changed      text[];
  v_user_id      uuid;
  v_role         text;
  v_ip           inet;
  v_agent        text;
  v_impersonated boolean := false;
  v_operation    text;
  v_headers      json;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);

  begin
    v_tenant_id := coalesce(
      nullif(v_row ->> 'tenant_id', ''),
      case when tg_table_name = 'tenants' then v_row ->> 'id' end
    )::uuid;
  exception when others then
    v_tenant_id := null;
  end;

  begin
    v_record_id := nullif(v_row ->> 'id', '')::uuid;
  exception when others then
    v_record_id := null;
  end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key);

    if v_changed = array['updated_at'] then
      return coalesce(new, old);
    end if;
  end if;

  v_user_id := auth.uid();

  begin
    v_role := coalesce(auth.jwt() ->> 'role', current_user);
  exception when others then
    v_role := current_user;
  end;

  -- Set by the RPC that is performing the write, for this transaction only.
  begin
    v_operation := nullif(current_setting('app.audit_operation', true), '');
  exception when others then
    v_operation := null;
  end;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_ip      := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
    v_agent   := v_headers ->> 'user-agent';
    v_impersonated := coalesce(v_headers ->> 'x-impersonated-tenant', '') <> '';
  exception when others then
    v_ip := null;
    v_agent := null;
  end;

  insert into public.audit_logs (
    tenant_id, table_name, record_id, action, operation, user_id, user_role,
    impersonated, old_data, new_data, changed_fields, ip_address, user_agent
  ) values (
    v_tenant_id, tg_table_name, v_record_id, tg_op::public.audit_action, v_operation,
    v_user_id, v_role, v_impersonated, v_old, v_new, v_changed, v_ip, v_agent
  );

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- set_kitchen_pause()
--
-- The pause the whole platform reacts to: the storefront's Realtime
-- subscription disables checkout, and price_cart() refuses to price while
-- it is on. Staff-level, because pacing the kitchen is the kitchen's job.
-- ---------------------------------------------------------------------
create or replace function public.set_kitchen_pause(
  p_tenant_id uuid,
  p_paused    boolean,
  p_reason    text default null
)
returns public.tenant_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.tenant_settings%rowtype;
begin
  if not public.has_tenant_access(p_tenant_id) then
    raise exception 'You do not have access to this kitchen' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.audit_operation', 'TOGGLE_KITCHEN_PAUSE', true);

  update public.tenant_settings
     set is_kitchen_paused = p_paused,
         kitchen_paused_reason = case when p_paused then nullif(btrim(coalesce(p_reason, '')), '') else null end
   where tenant_id = p_tenant_id
  returning * into v_settings;

  if not found then
    raise exception 'No settings for tenant %', p_tenant_id using errcode = 'no_data_found';
  end if;

  return v_settings;
end;
$$;

-- ---------------------------------------------------------------------
-- adjust_prep_time()
--
-- Takes a delta, not an absolute value: two expediters tapping "+5" at the
-- same moment should add ten minutes, not race to the same number.
-- ---------------------------------------------------------------------
create or replace function public.adjust_prep_time(
  p_tenant_id  uuid,
  p_delta_mins integer
)
returns public.tenant_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.tenant_settings%rowtype;
begin
  if not public.has_tenant_access(p_tenant_id) then
    raise exception 'You do not have access to this kitchen' using errcode = 'insufficient_privilege';
  end if;

  if p_delta_mins not between -120 and 120 then
    raise exception 'Prep time adjustment is out of range' using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_operation', 'ADJUST_PREP_TIME', true);

  update public.tenant_settings
     set estimated_prep_time_mins =
           least(240, greatest(0, estimated_prep_time_mins + p_delta_mins))
   where tenant_id = p_tenant_id
  returning * into v_settings;

  if not found then
    raise exception 'No settings for tenant %', p_tenant_id using errcode = 'no_data_found';
  end if;

  return v_settings;
end;
$$;

-- ---------------------------------------------------------------------
-- advance_order_status()
--
-- The KDS buttons. A transition table rather than a free UPDATE, so a
-- double-tap or a stale board cannot move an order somewhere impossible --
-- back into the kitchen after it left, or out for delivery when it was
-- ordered for pickup.
-- ---------------------------------------------------------------------
create or replace function public.advance_order_status(
  p_order_id  uuid,
  p_to_status public.order_status,
  p_note      text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_allowed public.order_status[];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Unknown order %', p_order_id using errcode = 'no_data_found';
  end if;

  if not public.has_tenant_access(v_order.tenant_id) then
    raise exception 'You do not have access to this order' using errcode = 'insufficient_privilege';
  end if;

  v_allowed := case v_order.status
    when 'paid'             then array['confirmed','preparing','cancelled']::public.order_status[]
    when 'confirmed'        then array['preparing','cancelled']::public.order_status[]
    when 'preparing'        then array['ready','cancelled']::public.order_status[]
    when 'ready'            then case
                                   when v_order.fulfillment_type = 'delivery'
                                     then array['out_for_delivery','completed','cancelled']::public.order_status[]
                                   else array['completed','cancelled']::public.order_status[]
                                 end
    when 'out_for_delivery' then array['completed','cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end;

  if not (p_to_status = any (v_allowed)) then
    raise exception 'An order that is % cannot become %', v_order.status, p_to_status
      using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_operation', 'ADVANCE_ORDER_STATUS', true);

  update public.orders
     set status = p_to_status,
         cancellation_reason = case
           when p_to_status = 'cancelled' then nullif(btrim(coalesce(p_note, '')), '')
           else cancellation_reason
         end
   where id = p_order_id
  returning * into v_order;

  -- fn_orders_record_status_event() already appended the history row; this
  -- attaches the operator's note to it.
  if p_note is not null and btrim(p_note) <> '' then
    update public.order_status_events
       set note = btrim(p_note)
     where id = (
       select id from public.order_status_events
       where order_id = p_order_id order by created_at desc, id desc limit 1
     );
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants: kitchen staff only. None of these are reachable by anon, and
-- each re-checks tenant membership itself rather than trusting the caller.
-- ---------------------------------------------------------------------
revoke all on function public.set_kitchen_pause(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.adjust_prep_time(uuid, integer) from public, anon, authenticated;
revoke all on function public.advance_order_status(uuid, public.order_status, text) from public, anon, authenticated;

grant execute on function public.set_kitchen_pause(uuid, boolean, text) to authenticated;
grant execute on function public.adjust_prep_time(uuid, integer) to authenticated;
grant execute on function public.advance_order_status(uuid, public.order_status, text) to authenticated;

-- The KDS subscribes to order_items so a ticket redraws when a line
-- changes. Realtime cannot evaluate a filtered RLS UPDATE without the full
-- old row.
alter table public.order_item_modifiers replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'order_item_modifiers'
    ) then
      alter publication supabase_realtime add table public.order_item_modifiers;
    end if;
  end if;
end;
$$;
