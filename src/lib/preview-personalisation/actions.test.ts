import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ resolve: vi.fn(), ensure: vi.fn(), upload: vi.fn(), signed: vi.fn(), remove: vi.fn(), from: vi.fn(), assets: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./tenant', () => ({ resolvePreviewTenant: m.resolve }));
vi.mock('./session', () => ({ ensurePreviewSession: m.ensure, currentPreviewSession: vi.fn(), sessionAssets: m.assets }));
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: m.from, storage: { from: () => ({ upload: m.upload, createSignedUrl: m.signed, remove: m.remove }) } }) }));
import { uploadPreviewImage } from './actions';
const id = '5cdc250d-87c5-4651-a441-6037852ca1bd';
function form(kind: 'logo' | 'banner' = 'logo') {
  const data = new FormData();
  data.set('tenantId', id);
  data.set('kind', kind);
  data.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'logo.png', { type: 'image/png' }));
  return data;
}
beforeEach(() => { vi.resetAllMocks(); m.resolve.mockResolvedValue({ tenantId: id, persisted: false }); m.upload.mockResolvedValue({ error: null }); m.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.example/logo' } }); });
it.each(['logo', 'banner'] as const)('uploads fallback-only %s images without a foreign-key-dependent session', async (kind) => {
  expect(await uploadPreviewImage(form(kind))).toMatchObject({ ok: true, url: 'https://storage.example/logo' });
  expect(m.upload.mock.calls[0][0]).toMatch(new RegExp(`^previews/${id}/`));
  expect(m.ensure).not.toHaveBeenCalled();
  expect(m.from).not.toHaveBeenCalled();
});
it('rejects unknown tenants before touching storage', async () => {
  m.resolve.mockResolvedValue(null);
  expect(await uploadPreviewImage(form())).toEqual({ ok: false, error: 'Tenant not found.', message: 'Tenant not found.' });
  expect(m.upload).not.toHaveBeenCalled();
});
it('returns a structured storage failure', async () => {
  m.upload.mockResolvedValue({ error: { message: 'unavailable' } });
  expect(await uploadPreviewImage(form())).toMatchObject({ ok: false });
  expect(m.signed).not.toHaveBeenCalled();
});
it('cleans up if a usable image URL cannot be issued', async () => {
  m.signed.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  expect(await uploadPreviewImage(form())).toMatchObject({ ok: false });
  expect(m.remove).toHaveBeenCalled();
});

it.each(['logo', 'banner'] as const)('returns storage errors for %s as structured data', async (kind) => {
  m.upload.mockRejectedValue(new Error('Storage unavailable'));
  expect(await uploadPreviewImage(form(kind))).toEqual({ ok: false, error: 'Storage unavailable', message: 'Storage unavailable' });
});
it('accepts a banner larger than the old 1 MB transport limit', async () => {
  const data = form('banner');
  const bytes = new Uint8Array(2 * 1024 * 1024);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  data.set('file', new File([bytes], 'banner.png', { type: 'image/png' }));
  expect(await uploadPreviewImage(data)).toMatchObject({ ok: true, kind: 'banner' });
  expect(m.upload.mock.calls[0][0]).toContain('/banner-');
});
it('rejects an oversized banner without contacting storage', async () => {
  const data = form('banner');
  data.set('file', new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'banner.png', { type: 'image/png' }));
  expect(await uploadPreviewImage(data)).toMatchObject({ ok: false, error: 'Images must be 4MB or smaller.' });
  expect(m.upload).not.toHaveBeenCalled();
});

it.each(['logo', 'banner'] as const)('stores %s metadata in the same session upload flow', async (kind) => {
  m.resolve.mockResolvedValue({ tenantId: id, persisted: true });
  m.ensure.mockResolvedValue({ id: 'test-session' });
  m.assets.mockResolvedValue([]);
  const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'asset-id' }, error: null }) }) }));
  m.from.mockImplementation((table) => table === 'preview_session_assets'
    ? { insert }
    : { update: () => ({ eq: async () => ({ error: null }) }) });
  expect(await uploadPreviewImage(form(kind))).toMatchObject({ ok: true, assetId: 'asset-id', kind });
  expect(m.upload.mock.calls[0][0]).toMatch(new RegExp(`^test-session/${kind}-`));
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'test-session', kind, storage_path: m.upload.mock.calls[0][0] }));
});
