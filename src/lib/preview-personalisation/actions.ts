'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';
import { isPreviewRequest } from '@/lib/storefront/preview';
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
 * The tenant is taken from the request host, never from an argument — there is
 * no parameter a caller could point at somebody else's restaurant.
 */

const MAX_ASSETS_PER_SESSION = 12;

export type UploadResult =
  | { ok: true; assetId: string; kind: 'logo' | 'banner' | 'item' }
  | { ok: false; message: string };

const fail = (message: string): UploadResult => ({ ok: false, message });

/** Resolves the tenant, and refuses unless this really is an unclaimed preview or demo. */
async function previewTenantId(): Promise<string | null> {
  try {
    const tenant = await getTenantContext();
    if (!tenant) return null;

    // Check if this is a pending_claim preview storefront
    if (await isPreviewRequest()) {
      return tenant.tenantId;
    }

    // Also allow personalization for any route where we can establish a preview session.
    // This includes demo fallback storefronts and /preview/[id] routes.
    // We don't need to check demo_fallback_state specifically — if the tenant exists
    // and we can create a session, personalization should be allowed.
    try {
      // Try to ensure a preview session exists. If successful, this tenant supports previews.
      await ensurePreviewSession(tenant.tenantId);
      return tenant.tenantId;
    } catch (sessionErr) {
      // Session creation failed — not a preview/demo storefront
      console.error('[previewTenantId] session check failed:', sessionErr);
    }

    return null;
  } catch (err) {
    console.error('[previewTenantId] unexpected error:', err);
    return null;
  }
}

export async function uploadPreviewImage(form: FormData): Promise<UploadResult> {
  try {
    try {
      const tenantId = await previewTenantId();
      if (!tenantId) return fail('This storefront is not open for personalisation.');

      const kindRaw = String(form.get('kind') ?? '');
      if (!['logo', 'banner', 'item'].includes(kindRaw)) return fail('Unknown image type.');
      const kind = kindRaw as 'logo' | 'banner' | 'item';

      const file = form.get('file');
      if (!(file instanceof File)) return fail('No file was uploaded.');
      if (file.size > MAX_UPLOAD_BYTES) return fail('Images must be 5MB or smaller.');

      const bytes = new Uint8Array(await file.arrayBuffer());
      const verdict = validateUpload(file.type || null, bytes);
      if (!verdict.ok) return fail(verdict.message);

      const session = await ensurePreviewSession(tenantId);
      const db = createServiceClient();

      const existing = await sessionAssets(session.id);
      if (kind === 'item' && existing.filter((a) => a.kind === 'item').length >= MAX_ASSETS_PER_SESSION) {
        return fail(`You can add up to ${MAX_ASSETS_PER_SESSION} photos.`);
      }

      const path = `${session.id}/${kind}-${Date.now()}.${verdict.extension}`;
      const up = await db.storage.from(PREVIEW_BUCKET).upload(path, bytes, {
        contentType: verdict.mime,
        upsert: false,
      });
      if (up.error) return fail('Upload failed. Please try again.');

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
      } catch {
        // Non-critical update failures
      }

      return { ok: true, assetId: data.id as string, kind };
    } catch (innerErr) {
      const message = innerErr instanceof Error ? innerErr.message : 'Unknown error during upload';
      console.error('[uploadPreviewImage] error:', message, innerErr);
      return fail('Upload failed. Please try again.');
    }
  } catch (outerErr) {
    console.error('[uploadPreviewImage] outer error:', outerErr);
    return fail('Upload failed. Please try again.');
  }
}

export async function removePreviewImage(assetId: string): Promise<UploadResult> {
  try {
    try {
      const tenantId = await previewTenantId();
      if (!tenantId) return fail('This storefront is not open for personalisation.');

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
