-- =====================================================================
-- bootstrap-superadmin.sql
--
-- Promotes the first platform administrator. Run once, in the Supabase
-- SQL Editor, AFTER creating the user in Authentication -> Users.
--
-- This exists because of a deliberate chicken-and-egg: every path that can
-- grant privilege (provision_tenant, assign_tenant_owner,
-- start_impersonation) re-checks is_super_admin() itself, and the signup
-- trigger refuses to honour a client-supplied privileged role. So the very
-- first super admin cannot be made through the application at all -- only
-- here, by someone with database access.
--
-- ---------------------------------------------------------------------
-- NOTE ON THE SCHEMA
--
-- There is no `public.users` table and no `is_super_admin` COLUMN.
--   * `public.user_profiles` mirrors auth.users and holds the platform role
--   * `is_super_admin()` is a SECURITY DEFINER FUNCTION that reads
--     user_profiles.role
--   * the role itself lives in `user_profiles.role` (enum public.user_role)
--
-- A super admin is platform-scoped, so `tenant_id` must be NULL --
-- user_profiles_super_admin_scope_chk enforces it, and this script sets it
-- rather than leaving you to discover the constraint.
-- =====================================================================

\set ON_ERROR_STOP on

-- 1. Set this to the address you created in the Auth UI.
--    In the Supabase SQL Editor, replace the literal below directly.
do $$
declare
  v_email  constant text := 'info@vardros.com';   -- <<< the first platform administrator
  v_user   uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    raise exception
      'No auth user with email %. Create them in Authentication -> Users first, then re-run.',
      v_email;
  end if;

  -- The signup trigger creates the profile, but insert defensively in case
  -- the user predates it.
  insert into public.user_profiles (id, email, role, tenant_id)
  values (v_user, v_email, 'super_admin', null)
  on conflict (id) do update
    set role = 'super_admin',
        tenant_id = null,          -- required: a super admin belongs to no tenant
        email = coalesce(public.user_profiles.email, excluded.email);

  -- Recorded in audit_logs alongside the DML verb, so the first grant of
  -- platform privilege is not an unexplained UPDATE.
  perform set_config('app.audit_operation', 'BOOTSTRAP_SUPER_ADMIN', true);

  raise notice 'Promoted % (%) to super_admin', v_email, v_user;
end;
$$;

-- 2. Verify. Expect exactly one row, with a null tenant_id.
select
  p.id,
  p.email,
  p.role,
  p.tenant_id,
  (p.tenant_id is null) as correctly_platform_scoped
from public.user_profiles p
where p.role = 'super_admin';

-- 3. Sanity-check the function the whole console depends on. Run this while
--    signed in AS that user (the SQL Editor runs as postgres, where
--    auth.uid() is null and this will return false -- that is expected).
--
--    select public.is_super_admin();
