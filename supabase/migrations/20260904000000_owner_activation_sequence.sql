-- Claiming proves ownership; it must not publish an unconfirmed storefront.
-- Activation is a separate owner-only act after menu and branding review.

set check_function_bodies = off;

create or replace function public.claim_tenant(
  p_token uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text default null,
  p_phone text default null
)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
begin
  select * into v_tenant
  from public.tenants
  where claim_token = p_token
    and status = 'pending_claim'
    and (claim_token_expires_at is null or claim_token_expires_at > now())
  for update;

  if not found then
    raise exception 'This claim link is not valid, has expired, or has already been used'
      using errcode = 'no_data_found';
  end if;

  perform set_config('app.audit_operation', 'CLAIM_TENANT', true);

  insert into public.user_profiles (id, tenant_id, role, full_name, email, phone)
  values (p_user_id, v_tenant.id, 'tenant_owner',
          nullif(btrim(coalesce(p_full_name, '')), ''),
          nullif(btrim(coalesce(p_email, '')), ''),
          nullif(btrim(coalesce(p_phone, '')), ''))
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        role = 'tenant_owner',
        full_name = coalesce(excluded.full_name, public.user_profiles.full_name),
        email = coalesce(excluded.email, public.user_profiles.email),
        phone = coalesce(excluded.phone, public.user_profiles.phone);

  update public.tenants
     set status = 'pending',
         claimed_at = now(),
         support_email = coalesce(support_email, nullif(btrim(coalesce(p_email, '')), '')),
         claim_token = null,
         claim_token_expires_at = null
   where id = v_tenant.id
  returning * into v_tenant;

  insert into public.webhook_events (tenant_id, event_type, payload)
  values (
    v_tenant.id, 'tenant.provisioned',
    jsonb_build_object(
      'tenantId', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name,
      'claimedAt', v_tenant.claimed_at, 'ownerEmail', p_email
    )
  );

  return v_tenant;
end;
$$;

revoke all on function public.claim_tenant(uuid, uuid, text, text, text)
  from public, anon, authenticated;

-- The original privileged-column guard permits status changes only for the
-- platform. Add one narrow exception for the explicit owner activation RPC;
-- setting the operation name alone is insufficient because the owner binding
-- is checked again against the row being changed.
create or replace function public.fn_guard_tenant_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_super_admin() or auth.uid() is null then
    return new;
  end if;

  if current_setting('app.audit_operation', true) = 'ACTIVATE_STOREFRONT'
     and old.status = 'pending'
     and new.status = 'active'
     and exists (
       select 1 from public.user_profiles
       where id = auth.uid() and tenant_id = old.id and role = 'tenant_owner'
     )
  then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.subscription_status is distinct from old.subscription_status
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.slug is distinct from old.slug
  then
    raise exception 'Only a platform administrator may change tenant status, billing, or slug'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create or replace function public.activate_storefront(p_tenant_id uuid)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_settings public.tenant_settings%rowtype;
begin
  if not exists (
    select 1 from public.user_profiles
    where id = auth.uid()
      and tenant_id = p_tenant_id
      and role = 'tenant_owner'
  ) then
    raise exception 'Only the restaurant owner may activate this storefront'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Restaurant not found' using errcode = 'no_data_found';
  end if;

  if v_tenant.status = 'active' then
    return v_tenant;
  end if;
  if v_tenant.status <> 'pending' or v_tenant.claimed_at is null then
    raise exception 'This storefront is not ready for owner activation'
      using errcode = 'check_violation';
  end if;
  if v_tenant.menu_verified_at is null then
    raise exception 'Confirm the menu before activating the storefront'
      using errcode = 'check_violation';
  end if;

  select * into v_settings from public.tenant_settings where tenant_id = p_tenant_id;
  if v_settings.logo_url is null or v_settings.cover_image_url is null then
    raise exception 'Upload a logo and banner before activating the storefront'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_operation', 'ACTIVATE_STOREFRONT', true);
  update public.tenants
     set status = 'active',
         onboarded_at = coalesce(onboarded_at, now()),
         updated_at = now()
   where id = p_tenant_id
  returning * into v_tenant;

  return v_tenant;
end;
$$;

revoke all on function public.activate_storefront(uuid) from public, anon;
grant execute on function public.activate_storefront(uuid) to authenticated;

comment on function public.activate_storefront(uuid) is
  'Owner-only publication step. Requires a claimed pending tenant, confirmed menu, logo, and banner.';
