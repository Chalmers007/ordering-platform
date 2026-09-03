import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * The anonymous session that owns a set of preview uploads.
 *
 * ── How a stranger is kept out without a login ───────────────────────────────
 * The session is addressed by 256 bits from the CSPRNG, held in an httpOnly
 * cookie scoped to that one storefront host. Only its SHA-256 is stored, so
 * reading the table gives nobody a way in.
 *
 * That is the whole isolation model, and it is deliberate: the preview stays
 * publicly viewable — anyone with the link sees the menu — while only the
 * visitor holding the cookie can change its images. A second visitor gets
 * their own session and their own uploads.
 *
 * The cookie is per-host, so it does not follow the owner to another device.
 * Making it do so would require an email or a phone number, which is exactly
 * what this feature exists to avoid asking for. Until the storefront is
 * claimed, uploads live in the browser that made them.
 */
export const PREVIEW_COOKIE = 'preview_session';
const TOKEN_BYTES = 32;
const TTL_DAYS = 7;

export interface PreviewSession {
  id: string;
  tenantId: string;
  expiresAt: string;
}

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** The session this browser already holds for this tenant, if it is still live. */
export async function currentPreviewSession(tenantId: string): Promise<PreviewSession | null> {
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (!token) return null;

  const db = createServiceClient();
  const { data } = await db
    .from('preview_sessions')
    .select('id, tenant_id, expires_at')
    .eq('token_hash', hash(token))
    // Scoped to the tenant as well as the token: a cookie set on one
    // storefront must not address a session on another.
    .eq('tenant_id', tenantId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  return data ? { id: data.id as string, tenantId: data.tenant_id as string, expiresAt: data.expires_at as string } : null;
}

/** Reuses this browser's session, or starts one. */
export async function ensurePreviewSession(tenantId: string): Promise<PreviewSession> {
  const existing = await currentPreviewSession(tenantId);
  if (existing) return existing;

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();

  const db = createServiceClient();
  const { data, error } = await db
    .from('preview_sessions')
    .insert({ tenant_id: tenantId, token_hash: hash(token), expires_at: expiresAt } as never)
    .select('id, tenant_id, expires_at')
    .single();
  if (error || !data) throw new Error(`could not start a preview session: ${error?.message}`);

  (await cookies()).set(PREVIEW_COOKIE, token, {
    httpOnly: true,     // never readable by script, so an XSS cannot take the session
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_DAYS * 86_400,
  });

  return { id: data.id as string, tenantId: data.tenant_id as string, expiresAt: data.expires_at as string };
}

export interface PreviewAsset {
  id: string;
  kind: 'logo' | 'banner' | 'item';
  storagePath: string;
  mimeType: string;
}

export async function sessionAssets(sessionId: string): Promise<PreviewAsset[]> {
  const db = createServiceClient();
  const { data } = await db
    .from('preview_session_assets')
    .select('id, kind, storage_path, mime_type')
    .eq('session_id', sessionId)
    .order('created_at');
  return (data ?? []).map((a) => ({
    id: a.id as string,
    kind: a.kind as PreviewAsset['kind'],
    storagePath: a.storage_path as string,
    mimeType: a.mime_type as string,
  }));
}
