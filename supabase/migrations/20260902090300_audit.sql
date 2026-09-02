-- =====================================================================
-- 20260902090300_audit.sql
-- Generic, table-agnostic audit trail.
--
-- The trigger function derives tenant_id, record id, and the actor from
-- whatever row it is handed, so attaching it to a new table is one
-- statement and never needs a bespoke function.
-- =====================================================================

set check_function_bodies = off;

create type public.audit_action as enum ('INSERT', 'UPDATE', 'DELETE');

create table public.audit_logs (
  id             bigint generated always as identity primary key,
  tenant_id      uuid references public.tenants(id) on delete cascade,
  table_name     text not null,
  record_id      uuid,
  action         public.audit_action not null,

  user_id        uuid references auth.users(id) on delete set null,
  user_role      text,          -- postgrest role or platform role at time of write
  impersonated   boolean not null default false,

  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],

  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only. No UPDATE/DELETE policy exists for any client role.';

create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id, created_at desc);
create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- fn_audit_log()
-- Attach as: AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW
-- ---------------------------------------------------------------------
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
  v_headers      json;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);

  -- tenant_id column if the table has one; otherwise the row IS the tenant.
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

  -- Which columns actually moved. Cheap to compute, and it is what makes
  -- the audit UI readable instead of two walls of JSON.
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key);

    -- updated_at alone is noise, not a change.
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

  -- Request metadata is only present when the write came through PostgREST.
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
    tenant_id, table_name, record_id, action, user_id, user_role,
    impersonated, old_data, new_data, changed_fields, ip_address, user_agent
  ) values (
    v_tenant_id, tg_table_name, v_record_id, tg_op::public.audit_action,
    v_user_id, v_role, v_impersonated, v_old, v_new, v_changed, v_ip, v_agent
  );

  return coalesce(new, old);
end;
$$;

comment on function public.fn_audit_log() is
  'Generic audit trigger. Derives tenant_id/record_id from the row; skips updated_at-only updates.';

-- ---------------------------------------------------------------------
-- Attachment helper -- keeps every audited table wired identically.
-- ---------------------------------------------------------------------
create or replace function public.attach_audit_trigger(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := 'audit_' || split_part(p_table::text, '.', array_length(string_to_array(p_table::text, '.'), 1));
begin
  execute format('drop trigger if exists %I on %s', v_name, p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s
       for each row execute function public.fn_audit_log()',
    v_name, p_table
  );
end;
$$;

-- Required by spec:
select public.attach_audit_trigger('public.menu_items');
select public.attach_audit_trigger('public.orders');
select public.attach_audit_trigger('public.tenant_settings');

-- Same class of risk, same treatment: anything that changes who can be
-- billed, paid, or served is audited too.
select public.attach_audit_trigger('public.tenants');
select public.attach_audit_trigger('public.menu_modifiers');
select public.attach_audit_trigger('public.payment_gateway_accounts');
select public.attach_audit_trigger('public.user_profiles');
