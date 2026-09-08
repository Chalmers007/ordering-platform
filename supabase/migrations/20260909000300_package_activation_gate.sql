-- =====================================================================
-- 20260909000300_package_activation_gate.sql
--
-- Gate tenant activation on package payment confirmation.
-- If a tenant has a package_purchase record, it must be confirmed before
-- the tenant can be marked active. This prevents activation via browser
-- redirect or direct RPC calls.
-- =====================================================================

set lock_timeout = '5s';

create or replace function public.claim_tenant(
  p_token     uuid,
  p_user_id   uuid,
  p_email     text,
  p_full_name text default null,
  p_phone     text default null
)
returns public.tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_package_status text;
begin
  -- FOR UPDATE: two people opening the same emailed link at once must not
  -- both become the owner.
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

  -- Check if a package purchase exists for this tenant
  -- If so, it MUST be confirmed before activation
  select status into v_package_status
  from public.package_purchases
  where tenant_id = v_tenant.id
  limit 1;

  if v_package_status is not null and v_package_status != 'confirmed' then
    raise exception 'Payment has not been confirmed. Cannot claim at this time.'
      using errcode = 'integrity_constraint_violation';
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
     set status = 'active',
         claimed_at = now(),
         onboarded_at = coalesce(onboarded_at, now()),
         support_email = coalesce(support_email, nullif(btrim(coalesce(p_email, '')), '')),
         -- Destroyed, not merely expired: a link that has been used must
         -- not work again even before its expiry.
         claim_token = null,
         claim_token_expires_at = null
   where id = v_tenant.id
  returning * into v_tenant;

  -- Mark package as claimed if it exists
  update public.package_purchases
     set claimed_at = now()
   where tenant_id = v_tenant.id;

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
