import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ resolve: vi.fn(), ensure: vi.fn(), upload: vi.fn(), signed: vi.fn(), remove: vi.fn(), from: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./tenant', () => ({ resolvePreviewTenant: m.resolve }));
vi.mock('./session', () => ({ ensurePreviewSession: m.ensure, currentPreviewSession: vi.fn(), sessionAssets: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: m.from, storage: { from: () => ({ upload: m.upload, createSignedUrl: m.signed, remove: m.remove }) } }) }));
import { uploadPreviewImage } from './actions';
const id = '5cdc250d-87c5-4651-a441-6037852ca1bd';
function form() {
  const data = new FormData();
  data.set('tenantId', id);
  data.set('kind', 'logo');
  data.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'logo.png', { type: 'image/png' }));
  return data;
}
beforeEach(() => { vi.resetAllMocks(); m.resolve.mockResolvedValue({ tenantId: id, persisted: false }); m.upload.mockResolvedValue({ error: null }); m.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.example/logo' } }); });
it('uploads fallback-only images without inserting a foreign-key-dependent session', async () => {
  expect(await uploadPreviewImage(form())).toMatchObject({ ok: true, url: 'https://storage.example/logo' });
  expect(m.upload.mock.calls[0][0]).toMatch(new RegExp(`^previews/${id}/`));
  expect(m.ensure).not.toHaveBeenCalled();
  expect(m.from).not.toHaveBeenCalled();
});
it('rejects unknown tenants before touching storage', async () => {
  m.resolve.mockResolvedValue(null);
  expect(await uploadPreviewImage(form())).toEqual({ ok: false, message: 'Tenant not found.' });
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
