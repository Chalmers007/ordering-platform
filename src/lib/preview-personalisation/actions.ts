'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { resolvePreviewTenant } from './tenant';
import { randomUUID } from 'node:crypto';
import { ensurePreviewSession, currentPreviewSession, sessionAssets } from './session';
import { validateUpload, MAX_UPLOAD_BYTES } from './validate';
import { PREVIEW_BUCKET } from './bucket';

/**
 * Uploading images to a storefront nobody has claimed yet.
 *
 * ── What these actions can and cannot touch ──────────────────────────────────
 * Everything written here belongs to a SESSION. Nothing in this file writes to
 * `tenants`, `tenant_settings` or any menu row, and no code path here can make
 * a permanent storefront change. The transfer onto the tenant happens once, in
 * the claim route, and only after a claim has actually succeeded.
 *
 * Host tenants use trusted routing headers; path preview IDs are verified
 * against server-side tenant, fallback, or session records.
 */

const MAX_ASSETS_PER_SESSION = 12;

export type UploadResult =
  | { ok: true; assetId: string; url?: string; kind: 'logo' | 'banner' | 'item' }
  | { ok: false; error: string; message: string };

const fail = (message: string): UploadResult => ({ ok: false, error: message, message });

export async function uploadPreviewImage(form: FormData): Promise<UploadResult> {
  try {
    // Get tenant directly - if we have one in context, allow personalization
    const tenant = await resolvePreviewTenant(String(form.get('tenantId') ?? ''));
    if (!tenant) return fail('Tenant not found.');
    const tenantId = tenant.tenantId;

    const kindRaw = String(form.get('kind') ?? '');
    if (!['logo', 'banner', 'item'].includes(kindRaw)) return fail('Unknown image type.');
    const kind = kindRaw as 'logo' | 'banner' | 'item';

    const file = form.get('file');
    if (!(file instanceof File)) return fail('No file was uploaded.');
    if (file.size > MAX_UPLOAD_BYTES) return fail('Images must be 4MB or smaller.');

    const bytes = new Uint8Array(await file.arrayBuffer());
    const verdict = validateUpload(file.type || null, bytes);
    if (!verdict.ok) return fail(verdict.message);

    // Fallback-only demos cannot create a session with a tenants foreign key.
    if (!tenant.persisted && !tenant.session) {
      const db = createServiceClient();
      const path = `previews/${tenantId}/${kind}-${randomUUID()}.${verdict.extension}`;
      const bucket = db.storage.from(PREVIEW_BUCKET);
      const { error } = await bucket.upload(path, bytes, { contentType: verdict.mime, upsert: false });
      if (error) return fail(error.message);
      const { data: link, error: linkError } = await bucket.createSignedUrl(path, 604800);
      if (linkError || !link) {
        await bucket.remove([path]);
        return fail('Upload failed. Please try again.');
      }
      return { ok: true, assetId: '', kind, url: link.signedUrl };
    }
    const session = tenant.session ?? await ensurePreviewSession(tenantId);
    const db = createServiceClient();

    const existing = await sessionAssets(session.id);
    if (kind === 'item' && existing.filter((a) => a.kind === 'item').length >= MAX_ASSETS_PER_SESSION) {
      return fail(`You can add up to ${MAX_ASSETS_PER_SESSION} photos.`);
    }

    const path = `${session.id}/${kind}-${randomUUID()}.${verdict.extension}`;
    const up = await db.storage.from(PREVIEW_BUCKET).upload(path, bytes, {
      contentType: verdict.mime,
      upsert: false,
    });
    if (up.error) return fail(up.error.message);

    const previous = existing.find((a) => a.kind === kind && kind !== 'item');
    if (previous) {
      try {
        await db.storage.from(PREVIEW_BUCKET).remove([previous.storagePath]);
        await db.from('preview_session_assets').delete().eq('id', previous.id);
      } catch {
        // Cleanup errors don't block the upload
      }
    }

    const { data, error } = await db
      .from('preview_session_assets')
      .insert({ session_id: session.id, kind, storage_path: path, mime_type: verdict.mime, bytes: verdict.bytes } as never)
      .select('id')
      .single();
    if (error || !data) {
      try {
        await db.storage.from(PREVIEW_BUCKET).remove([path]);
      } catch {
        // Cleanup errors don't block the response
      }
      return fail('Upload failed. Please try again.');
    }

    try {
      await db.from('preview_sessions').update({ updated_at: new Date().toISOString() }).eq('id', session.id);
      revalidatePath('/');
      revalidatePath(`/preview/${tenantId}`);
    } catch {
      // Non-critical update failures
    }

    const { data: link } = await db.storage.from(PREVIEW_BUCKET).createSignedUrl(path, 604800);
    if (!link) return fail('Image saved, but its preview URL could not be created. Please try again.');
    return { ok: true, assetId: data.id as string, kind, url: link.signedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during upload';
    console.error('[uploadPreviewImage] error:', message);
    return fail(message);
  }
}

export async function removePreviewImage(assetId: string, requestedTenantId?: string): Promise<UploadResult> {
  try {
    try {
      // Get tenant directly - if we have one in context, allow personalization
      const tenant = await resolvePreviewTenant(requestedTenantId);
      if (!tenant) return fail('Tenant not found.');
      const tenantId = tenant.tenantId;

      const session = await currentPreviewSession(tenantId);
      // No session cookie means no claim to any of these files. This is what stops
      // one visitor deleting another's uploads.
      if (!session) return fail('That image does not belong to this preview.');

      const db = createServiceClient();
      const { data: asset } = await db
        .from('preview_session_assets')
        .select('id, storage_path, kind')
        .eq('id', assetId)
        .eq('session_id', session.id)
        .maybeSingle();
      if (!asset) return fail('That image does not belong to this preview.');

      await db.storage.from(PREVIEW_BUCKET).remove([asset.storage_path as string]);
      await db.from('preview_session_assets').delete().eq('id', asset.id);
      revalidatePath('/');
      revalidatePath(`/preview/${tenantId}`);
      return { ok: true, assetId: asset.id as string, kind: asset.kind as 'logo' | 'banner' | 'item' };
    } catch (innerErr) {
      const message = innerErr instanceof Error ? innerErr.message : 'Unknown error occurred during removal';
      console.error('[removePreviewImage] error:', message, innerErr);
      return fail('Failed to remove image. Please try again.');
    }
  } catch (outerErr) {
    console.error('[removePreviewImage] outer error:', outerErr);
    return fail('Failed to remove image. Please try again.');
  }
}
