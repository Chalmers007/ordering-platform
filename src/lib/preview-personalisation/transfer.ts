import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { PREVIEW_BUCKET } from './bucket';

/**
 * Move a preview session's images onto the tenant that has just been claimed.
 *
 * ── Ordering is the whole safety property ────────────────────────────────────
 * This runs AFTER claim_tenant() has returned successfully. If the claim fails
 * — a bad token, an expired link, someone else redeeming it first — this is
 * never reached and the files stay in the session, where they change nothing.
 * A preview that is simply abandoned expires and its files are deleted.
 *
 * A session is transferred exactly once: `transferred_at` is set, and an
 * already-transferred session is skipped. Its files then belong to the tenant
 * and are no longer the cleanup job's to delete.
 *
 * A failure here must not fail the claim. The restaurant owns its storefront
 * either way; the worst case is that they re-upload a logo.
 */
export interface TransferResult {
  transferred: number;
  logo: boolean;
  banner: boolean;
  error: string | null;
}

const TARGET_BUCKET = 'brand-assets';

export async function transferPreviewSession(tenantId: string, sessionId: string): Promise<TransferResult> {
  const result: TransferResult = { transferred: 0, logo: false, banner: false, error: null };
  const db = createServiceClient();

  try {
    const { data: session } = await db
      .from('preview_sessions')
      .select('id, tenant_id, transferred_at')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    // Wrong tenant, unknown session, or already done. All three are silent
    // no-ops rather than errors: none of them is a reason to trouble a
    // restaurant that has just taken possession of its storefront.
    if (!session || session.transferred_at) return result;

    const { data: assets } = await db
      .from('preview_session_assets')
      .select('id, kind, storage_path, mime_type')
      .eq('session_id', sessionId);

    const patch: Record<string, string> = {};
    for (const asset of assets ?? []) {
      const path = asset.storage_path as string;
      const ext = path.split('.').pop() ?? 'jpg';
      // The tenant id is the first path segment in brand-assets, which is what
      // the storage policies isolate on.
      const target = `${tenantId}/${asset.kind}-${Date.now()}-${result.transferred}.${ext}`;

      const file = await db.storage.from(PREVIEW_BUCKET).download(path);
      if (file.error || !file.data) continue;

      const up = await db.storage.from(TARGET_BUCKET).upload(target, file.data, {
        contentType: asset.mime_type as string,
        upsert: true,
      });
      if (up.error) continue;

      const { data: pub } = db.storage.from(TARGET_BUCKET).getPublicUrl(target);
      if (asset.kind === 'logo') { patch.logo_url = pub.publicUrl; result.logo = true; }
      if (asset.kind === 'banner') { patch.cover_image_url = pub.publicUrl; result.banner = true; }
      result.transferred += 1;
    }

    if (Object.keys(patch).length > 0) {
      await db.from('tenant_settings').update(patch as never).eq('tenant_id', tenantId);
    }

    await db.from('preview_sessions').update({ transferred_at: new Date().toISOString() } as never).eq('id', sessionId);
    // The originals are removed once they are safely copied: leaving them in a
    // bucket whose cleanup job now skips this session would orphan them.
    const paths = (assets ?? []).map((a) => a.storage_path as string);
    if (paths.length) await db.storage.from(PREVIEW_BUCKET).remove(paths);
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'transfer failed';
  }

  return result;
}
