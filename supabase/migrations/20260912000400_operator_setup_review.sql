-- Operator review for claimed restaurants. Approval is deliberately separate
-- from activation: activate_tenant_if_ready() still enforces payment, setup,
-- owner approval, and operator approval before changing tenant status.
alter table public.tenant_activation_requirements
  add column if not exists operator_decision text not null default 'pending'
    check (operator_decision in ('pending', 'approved', 'rejected')),
  add column if not exists operator_reason text,
  add column if not exists operator_decided_at timestamptz,
  add column if not exists operator_decided_by uuid references auth.users(id);

update public.tenant_activation_requirements
set operator_decision = 'approved'
where operator_approved_at is not null and operator_decision = 'pending';

comment on column public.tenant_activation_requirements.operator_decision is
  'Operator review state; approval does not activate a tenant by itself.';

create or replace function public.review_tenant_setup(
  p_tenant_id uuid,
  p_decision text,
  p_reason text default null
)
returns public.tenant_activation_requirements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.tenant_activation_requirements;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_super_admin() then
    raise exception 'Only a Vardr operator can review setup' using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = 'invalid_parameter_value';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'A reason is required when setup is rejected' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id and status = 'pending') then
    raise exception 'Only claimed pending restaurants can be reviewed' using errcode = 'no_data_found';
  end if;

  if p_decision = 'approved' and not (
    exists (select 1 from public.user_profiles where tenant_id = p_tenant_id and role = 'tenant_owner')
    and exists (select 1 from public.package_purchases where tenant_id = p_tenant_id and status = 'confirmed')
    and exists (select 1 from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
      where t.id = p_tenant_id and nullif(t.name, '') is not null
        and nullif(t.support_email, '') is not null and nullif(t.support_phone, '') is not null
        and nullif(s.logo_url, '') is not null and nullif(s.cover_image_url, '') is not null)
    and exists (select 1 from public.menu_items where tenant_id = p_tenant_id and source = 'owner')
    and exists (select 1 from public.tenant_activation_requirements
      where tenant_id = p_tenant_id and owner_approved_at is not null)
  ) then
    raise exception 'Setup is incomplete; approval cannot be recorded' using errcode = 'check_violation';
  end if;

  insert into public.tenant_activation_requirements (tenant_id)
    values (p_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.tenant_activation_requirements
    set operator_decision = p_decision,
        operator_reason = v_reason,
        operator_decided_at = now(),
        operator_decided_by = auth.uid(),
        operator_approved_at = case when p_decision = 'approved' then now() else null end,
        updated_at = now()
    where tenant_id = p_tenant_id
    returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.review_tenant_setup(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_tenant_setup(uuid, text, text) to authenticated;
