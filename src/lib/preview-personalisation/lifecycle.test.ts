import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env.local');

/**
 * Session isolation, expiry, transfer-on-claim, and the promise that nothing
 * here touches a real storefront before it is claimed.
 *
 * Behavioural against the local database and storage.
 */
const TENANT = '0a77dd00-0000-4000-8000-000000000001';
const OTHER = '0a77dd00-0000-4000-8000-000000000002';
const BUCKET = 'preview-uploads';
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const hash = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

async function makeSession(tenantId: string, token: string, expiresAt?: string) {
  const { data, error } = await db()
    .from('preview_sessions')
    .insert({ tenant_id: tenantId, token_hash: hash(token), ...(expiresAt ? { expires_at: expiresAt } : {}) } as never)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

async function addAsset(sessionId: string, kind: string, path: string) {
  await db().storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true });
  const { data, error } = await db()
    .from('preview_session_assets')
    .insert({ session_id: sessionId, kind, storage_path: path, mime_type: 'image/jpeg', bytes: jpeg.length } as never)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

beforeAll(async () => {
  const c = db();
  for (const t of [TENANT, OTHER]) {
    await c.from('preview_sessions').delete().eq('tenant_id', t);
    await c.from('tenants').delete().eq('id', t);
  }
  await c.from('tenants').insert([
    { id: TENANT, name: 'Personalise Co', slug: 'personalise-co', status: 'pending_claim' },
    { id: OTHER, name: 'Other Co', slug: 'other-co', status: 'pending_claim' },
  ] as never);
});

afterAll(async () => {
  const c = db();
  for (const t of [TENANT, OTHER]) {
    await c.from('preview_sessions').delete().eq('tenant_id', t);
    await c.from('tenants').delete().eq('id', t);
  }
});

describe('session isolation', () => {
  it('a token only addresses its own session, and only for its own tenant', async () => {
    const mine = await makeSession(TENANT, 'token-mine');
    await makeSession(OTHER, 'token-theirs');

    // The lookup the server does: hash + tenant.
    const { data: found } = await db().from('preview_sessions').select('id')
      .eq('token_hash', hash('token-mine')).eq('tenant_id', TENANT).maybeSingle();
    expect(found!.id).toBe(mine);

    // The same cookie presented on another storefront resolves to nothing.
    const { data: crossed } = await db().from('preview_sessions').select('id')
      .eq('token_hash', hash('token-mine')).eq('tenant_id', OTHER).maybeSingle();
    expect(crossed).toBeNull();
  });

  it('stores only the hash, so reading the table cannot take over a session', async () => {
    const { data } = await db().from('preview_sessions').select('*').eq('tenant_id', TENANT).limit(1).single();
    expect(JSON.stringify(data)).not.toContain('token-mine');
    expect(data!.token_hash).toBe(hash('token-mine'));
  });

  it('is invisible to anon and authenticated', async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data, error } = await anon.from('preview_sessions').select('id');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe('uploads never touch the tenant before a claim', () => {
  it('leaves tenant_settings and the tenant row untouched', async () => {
    const s = await makeSession(TENANT, 'token-untouched');
    await addAsset(s, 'logo', `${s}/logo-1.jpg`);
    await addAsset(s, 'banner', `${s}/banner-1.jpg`);

    const { data: settings } = await db().from('tenant_settings').select('logo_url, cover_image_url').eq('tenant_id', TENANT).single();
    expect(settings!.logo_url).toBeNull();
    expect(settings!.cover_image_url).toBeNull();
    const { data: tenant } = await db().from('tenants').select('status').eq('id', TENANT).single();
    expect(tenant!.status).toBe('pending_claim');
  });

  it('keeps one logo and one banner per session — replacing does not accumulate', async () => {
    const s = await makeSession(TENANT, 'token-replace');
    await addAsset(s, 'logo', `${s}/logo-a.jpg`);
    await expect(addAsset(s, 'logo', `${s}/logo-b.jpg`)).rejects.toThrow();
    const { data } = await db().from('preview_session_assets').select('id').eq('session_id', s).eq('kind', 'logo');
    expect(data).toHaveLength(1);
  });

  it('refuses a file type the database does not allow', async () => {
    const s = await makeSession(TENANT, 'token-mime');
    const { error } = await db().from('preview_session_assets')
      .insert({ session_id: s, kind: 'logo', storage_path: `${s}/x.svg`, mime_type: 'image/svg+xml', bytes: 10 } as never);
    expect(error).not.toBeNull();
  });

  it('refuses a file over the size limit', async () => {
    const s = await makeSession(TENANT, 'token-size');
    const { error } = await db().from('preview_session_assets')
      .insert({ session_id: s, kind: 'logo', storage_path: `${s}/big.jpg`, mime_type: 'image/jpeg', bytes: 5242881 } as never);
    expect(error).not.toBeNull();
  });
});

describe('expiry and cleanup', () => {
  it('lists an abandoned session with the files to delete', async () => {
    const stale = await makeSession(TENANT, 'token-stale', new Date(Date.now() - 86_400_000).toISOString());
    await addAsset(stale, 'logo', `${stale}/logo.jpg`);

    const { data } = await db().rpc('expired_preview_sessions', { p_limit: 100 } as never);
    const row = (data as { id: string; storage_paths: string[] }[]).find((r) => r.id === stale);
    expect(row).toBeDefined();
    expect(row!.storage_paths).toContain(`${stale}/logo.jpg`);
  });

  it('never lists a live session', async () => {
    const live = await makeSession(TENANT, 'token-live');
    const { data } = await db().rpc('expired_preview_sessions', { p_limit: 100 } as never);
    expect((data as { id: string }[]).some((r) => r.id === live)).toBe(false);
  });

  it('never lists a session whose files were transferred — they belong to the tenant now', async () => {
    const done = await makeSession(TENANT, 'token-done', new Date(Date.now() - 86_400_000).toISOString());
    await db().from('preview_sessions').update({ transferred_at: new Date().toISOString() } as never).eq('id', done);
    const { data } = await db().rpc('expired_preview_sessions', { p_limit: 100 } as never);
    expect((data as { id: string }[]).some((r) => r.id === done)).toBe(false);
  });

  it('deleting a session removes its asset rows', async () => {
    const s = await makeSession(TENANT, 'token-cascade');
    await addAsset(s, 'logo', `${s}/logo.jpg`);
    await db().from('preview_sessions').delete().eq('id', s);
    const { data } = await db().from('preview_session_assets').select('id').eq('session_id', s);
    expect(data).toHaveLength(0);
  });
});

/**
 * These need working object storage. The local Supabase storage container has
 * been observed returning 502 through the gateway after a `db reset`, which is
 * an environment fault — skipping says so plainly instead of reporting a code
 * regression that is not there.
 */
async function storageWorks(): Promise<boolean> {
  const r = await db().storage.from(BUCKET).upload(`healthcheck/${Date.now()}.jpg`, jpeg, { contentType: 'image/jpeg' });
  return !r.error;
}

describe('transfer on claim', () => {
  it('moves the images onto the tenant and marks the session done', async (ctx) => {
    if (!(await storageWorks())) return ctx.skip();
    const { transferPreviewSession } = await import('./transfer');
    const s = await makeSession(TENANT, 'token-transfer');
    await addAsset(s, 'logo', `${s}/logo.jpg`);
    await addAsset(s, 'banner', `${s}/banner.jpg`);

    const result = await transferPreviewSession(TENANT, s);
    expect(result.transferred).toBe(2);
    expect(result.logo && result.banner).toBe(true);

    const { data: settings } = await db().from('tenant_settings').select('logo_url, cover_image_url').eq('tenant_id', TENANT).single();
    expect(settings!.logo_url).toContain('brand-assets');
    expect(settings!.cover_image_url).toContain('brand-assets');

    const { data: session } = await db().from('preview_sessions').select('transferred_at').eq('id', s).single();
    expect(session!.transferred_at).not.toBeNull();
  });

  it('is a no-op the second time — a session transfers exactly once', async () => {
    const { transferPreviewSession } = await import('./transfer');
    const { data: before } = await db().from('preview_sessions').select('id').eq('tenant_id', TENANT).not('transferred_at', 'is', null).limit(1).single();
    const again = await transferPreviewSession(TENANT, before!.id as string);
    expect(again.transferred).toBe(0);
  });

  it('refuses a session belonging to another tenant', async () => {
    const { transferPreviewSession } = await import('./transfer');
    const theirs = await makeSession(OTHER, 'token-theirs-2');
    await addAsset(theirs, 'logo', `${theirs}/logo.jpg`);

    // The claim route resolves the session by cookie AND tenant, but the
    // transfer checks again: a mismatch writes nothing.
    const result = await transferPreviewSession(TENANT, theirs);
    expect(result.transferred).toBe(0);
    const { data: other } = await db().from('tenant_settings').select('logo_url').eq('tenant_id', OTHER).single();
    expect(other!.logo_url).toBeNull();
  });
});

describe('what a public preview page exposes', () => {
  it('carries no session token, session id, bucket name or cookie name', async () => {
    // These are the secrets this feature introduces. The session token is what
    // grants control of the uploads, so it must never reach the page — it
    // lives in an httpOnly cookie and nowhere else.
    const fs = await import('node:fs');
    // Comments legitimately discuss tokens; what matters is whether any of
    // this reaches the rendered output. Strip comments, then look at the code.
    const code = (path: string) =>
      fs.readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const src of [
      code('src/components/storefront/preview-banner.tsx'),
      code('src/components/storefront/personalise-panel.tsx'),
    ]) {
      expect(src).not.toMatch(/token/i);
      expect(src).not.toMatch(/preview-uploads/);
      expect(src).not.toMatch(/session[iI]d/);
      expect(src).not.toMatch(/service_role|SUPABASE_SERVICE/);
    }
    // Asset URLs address an asset id, never a storage path.
    const layout = fs.readFileSync('src/app/(storefront)/store/layout.tsx', 'utf8');
    expect(layout).toMatch(/\/preview-asset\/\$\{uploaded(Logo|Banner)\.id\}/);
    expect(layout).not.toMatch(/storagePath|storage_path/);
  });

  it('the tenant id reaching the client is pre-existing, not from this feature', async () => {
    // Honest record: tenantId IS in the RSC payload of every storefront,
    // because the cart provider and the kitchen-status realtime subscription
    // take it as a prop. That predates this work and is the same on live
    // storefronts. It is an identifier, not a credential — RLS is the boundary
    // — but it is not hidden, and this test exists so nobody reads the
    // preview-security claims as saying otherwise.
    const fs = await import('node:fs');
    const layout = fs.readFileSync('src/app/(storefront)/store/layout.tsx', 'utf8');
    expect(layout).toMatch(/tenantId=\{tenant\.tenantId\}/);
  });
});
