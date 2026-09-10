import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ context: vi.fn(), session: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/tenancy/context', () => ({ getTenantContext: mocks.context }));
vi.mock('./session', () => ({ currentPreviewSession: mocks.session }));
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: mocks.from }) }));
import { resolvePreviewTenant } from './tenant';
const id = '5cdc250d-87c5-4651-a441-6037852ca1bd';
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue(null); mocks.session.mockResolvedValue(null); });
function rows(tenant: unknown, fallback: unknown) {
  mocks.from.mockImplementation((table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'tenants' ? tenant : fallback }) }) }) }));
}
it('resolves a path preview without host headers', async () => {
  rows({ id }, null);
  expect(await resolvePreviewTenant(id)).toEqual({ tenantId: id, persisted: true });
});
it('accepts a verified fallback without a primary tenant', async () => {
  rows(null, { tenant_id: id });
  expect(await resolvePreviewTenant(id)).toEqual({ tenantId: id, persisted: false });
});
it('accepts an existing cookie-authenticated session', async () => {
  rows(null, null);
  const session = { id: 'session', tenantId: id };
  mocks.session.mockResolvedValue(session);
  expect(await resolvePreviewTenant(id)).toEqual({ tenantId: id, persisted: false, session });
});
it('rejects unknown IDs and malformed IDs', async () => {
  rows(null, null);
  expect(await resolvePreviewTenant(id)).toBeNull();
  expect(await resolvePreviewTenant('invalid')).toBeNull();
});
it('keeps host context authoritative', async () => {
  mocks.context.mockResolvedValue({ tenantId: 'host-tenant' });
  expect(await resolvePreviewTenant(id)).toEqual({ tenantId: 'host-tenant', persisted: true });
  expect(mocks.from).not.toHaveBeenCalled();
});
