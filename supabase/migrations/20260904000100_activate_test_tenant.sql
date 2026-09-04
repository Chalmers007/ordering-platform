-- Activate the synthetic test tenant 'vardr-upload-test'
-- This migration:
--  1. Marks the tenant's menu as verified
--  2. Activates the storefront via the RPC
--  3. Logs the change for audit purposes

BEGIN;

-- First, find the tenant and mark menu as verified if not already
UPDATE public.tenants
SET menu_verified_at = COALESCE(menu_verified_at, now())
WHERE slug = 'vardr-upload-test';

-- Call the activation RPC for the tenant
-- This will transition status from 'pending' to 'active'
-- and validate all prerequisites.
SELECT public.activate_storefront(id)
FROM public.tenants
WHERE slug = 'vardr-upload-test';

-- Log the activation
INSERT INTO public.audit_logs (table_name, record_id, operation, action, changed_fields, tenant_id, user_id, user_role)
SELECT
  'tenants',
  t.id,
  'UPDATE',
  'TENANT_ACTIVATION'::public.audit_action,
  '["status"]'::text[],
  t.id,
  auth.uid(),
  'service'
FROM public.tenants t
WHERE t.slug = 'vardr-upload-test';

COMMIT;
