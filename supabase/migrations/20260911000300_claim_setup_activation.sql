-- Keep claiming separate from activation. A claimed restaurant remains
-- pending until payment, setup, and both approvals are complete.
create table if not exists public.tenant_activation_requirements (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  owner_approved_at timestamptz,
  operator_approved_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on public.tenant_activation_requirements from public, anon;
grant select on public.tenant_activation_requirements to authenticated;
drop policy if exists tenant_activation_requirements_select on public.tenant_activation_requirements;
create policy tenant_activation_requirements_select on public.tenant_activation_requirements
  for select to authenticated using (public.has_tenant_access(tenant_id));

create or replace function public.claim_tenant(
  p_token uuid, p_user_id uuid, p_email text,
  p_full_name text default null, p_phone text default null
)
returns public.tenants language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_tenant public.tenants%rowtype;
begin
  select * into v_tenant from public.tenants
  where claim_token = p_token and status = 'pending_claim'
    and (claim_token_expires_at is null or claim_token_expires_at > now())
  for update;
  if not found then raise exception 'This claim link is not valid, has expired, or has already been used' using errcode = 'no_data_found'; end if;
  insert into public.user_profiles (id, tenant_id, role, full_name, email, phone)
  values (p_user_id, v_tenant.id, 'tenant_owner', nullif(btrim(coalesce(p_full_name, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''))
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'tenant_owner', full_name = coalesce(excluded.full_name, public.user_profiles.full_name), email = coalesce(excluded.email, public.user_profiles.email), phone = coalesce(excluded.phone, public.user_profiles.phone);
  update public.tenants set status = 'pending', claimed_at = now(), onboarded_at = coalesce(onboarded_at, now()), support_email = coalesce(support_email, nullif(btrim(coalesce(p_email, '')), '')), claim_token = null, claim_token_expires_at = null where id = v_tenant.id returning * into v_tenant;
  insert into public.tenant_activation_requirements(tenant_id) values (v_tenant.id) on conflict (tenant_id) do nothing;
  update public.demo_fallback_state set state = 'claimed', claimed_at = now(), updated_at = now() where tenant_id = v_tenant.id;
  insert into public.webhook_events (tenant_id, event_type, payload) values (v_tenant.id, 'tenant.provisioned', jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name, 'claimedAt', v_tenant.claimed_at, 'ownerEmail', p_email));
  return v_tenant;
end; $$;

create or replace function public.approve_tenant_setup(p_tenant_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.can_manage_tenant(p_tenant_id) then raise exception 'Only the restaurant owner can approve setup'; end if;
  update public.tenant_activation_requirements set owner_approved_at = now(), updated_at = now() where tenant_id = p_tenant_id;
  return true;
end; $$;

create or replace function public.activate_tenant_if_ready(p_tenant_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare ok boolean;
begin
  select exists (select 1 from public.user_profiles u where u.tenant_id = p_tenant_id and u.role = 'tenant_owner')
    and exists (select 1 from public.package_purchases p where p.tenant_id = p_tenant_id and p.status = 'confirmed')
    and exists (select 1 from public.tenants t join public.tenant_settings s on s.tenant_id=t.id where t.id=p_tenant_id and nullif(t.name,'') is not null and nullif(t.support_email,'') is not null and nullif(t.support_phone,'') is not null and nullif(s.logo_url,'') is not null and nullif(s.cover_image_url,'') is not null)
    and exists (select 1 from public.menu_items i where i.tenant_id=p_tenant_id and i.source='owner')
    and exists (select 1 from public.tenant_activation_requirements r where r.tenant_id=p_tenant_id and r.owner_approved_at is not null and r.operator_approved_at is not null)
  into ok;
  if not ok then return false; end if;
  update public.tenants set status='active' where id=p_tenant_id and status <> 'cancelled';
  update public.tenant_activation_requirements set activated_at=now(), updated_at=now() where tenant_id=p_tenant_id;
  return true;
end; $$;

create or replace function public.approve_tenant_operator(p_tenant_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() <> 'service_role' and not public.is_super_admin() then raise exception 'Only a Vardr operator can approve activation'; end if;
  update public.tenant_activation_requirements set operator_approved_at = now(), updated_at = now() where tenant_id = p_tenant_id;
  return found;
end; $$;

revoke all on function public.approve_tenant_setup(uuid) from public, anon;
grant execute on function public.approve_tenant_setup(uuid) to authenticated;
revoke all on function public.activate_tenant_if_ready(uuid) from public, anon, authenticated;
revoke all on function public.approve_tenant_operator(uuid) from public, anon;
grant execute on function public.approve_tenant_operator(uuid) to authenticated;
