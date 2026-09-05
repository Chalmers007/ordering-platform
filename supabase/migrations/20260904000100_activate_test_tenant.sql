-- =====================================================================
-- 20260904000100_activate_test_tenant.sql
-- Activate the synthetic test tenant 'vardr-upload-test'.
--
-- Rewritten 2026-09-05. The original could never apply against this
-- schema, in three separate ways:
--   * it called public.activate_storefront(id), which does not exist;
--   * it wrote action = 'TENANT_ACTIVATION'::audit_action, but that enum
--     holds only INSERT/UPDATE/DELETE — the descriptive verb belongs in
--     the separate `operation` text column (see 20260902090800_kds.sql);
--   * changed_fields is text[], and '["status"]' is a JSON array, not an
--     array literal, so it raised "malformed array literal".
-- Every statement is now idempotent, because production reached this
-- state by hand on 2026-09-04 and must not be disturbed by a re-run.
-- =====================================================================

begin;

update public.tenants
set menu_verified_at = coalesce(menu_verified_at, now()),
    status = case when status = 'pending' then 'active'::public.tenant_status else status end
where slug = 'vardr-upload-test';

-- Recorded only when it is genuinely new, so re-running does not append
-- a second activation row to the audit trail.
insert into public.audit_logs
  (table_name, record_id, action, operation, changed_fields, tenant_id, user_role)
select 'tenants', t.id, 'UPDATE'::public.audit_action, 'TENANT_ACTIVATION',
       array['status','menu_verified_at']::text[], t.id, 'service'
from public.tenants t
where t.slug = 'vardr-upload-test'
  and not exists (
    select 1 from public.audit_logs a
    where a.table_name = 'tenants'
      and a.record_id = t.id
      and a.operation = 'TENANT_ACTIVATION'
  );

commit;
