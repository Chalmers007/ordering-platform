-- =====================================================================
-- 20260903000300_audit_survives_tenant_delete.sql
--
-- Deleting a tenant was impossible.
--
-- `audit_logs.tenant_id` had a foreign key to `tenants` with ON DELETE
-- CASCADE. Removing a tenant deletes the row, then cascades into its menu,
-- orders and settings — and the audit trigger fires on each of those
-- deletions and tries to insert a row referencing the tenant that has just
-- gone. The FK rejects it and the whole transaction rolls back:
--
--   23503: insert or update on table "audit_logs" violates foreign key
--          constraint "audit_logs_tenant_id_fkey"
--
-- This was not theoretical. The provisioning route in
-- /api/admin/tenants deletes the tenant when the owner cannot be invited,
-- precisely so nobody is left with a restaurant they cannot reach — and
-- that rollback could never have worked.
--
-- The fix is to drop the constraint, not to weaken it to SET NULL: the
-- insert happens while the referenced row is already gone, so SET NULL
-- fails identically. tenant_id stays as an indexed uuid.
--
-- That is also the right shape for this table. An append-only audit trail
-- should outlive the thing it records — "who deleted this restaurant, and
-- when" is exactly the question you ask after a tenant is gone, and a
-- cascade would have erased the answer along with the evidence.
-- =====================================================================

alter table public.audit_logs
  drop constraint if exists audit_logs_tenant_id_fkey;

comment on column public.audit_logs.tenant_id is
  'The tenant this record concerns. Deliberately NOT a foreign key: the trail must survive the tenant, and the audit trigger writes rows during the cascade that deletes it.';

-- The index the RLS policy and the console's filters rely on already
-- exists (audit_logs_tenant_created_idx); nothing else changes.
