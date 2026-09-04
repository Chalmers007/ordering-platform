'use server';

import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import type { ActionResult } from '@/types/database';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BUCKET = 'branding';

/**
 * Upload a branding image (logo or hero banner) to tenant-isolated storage.
 *
 * Files are stored at: branding/{tenantId}/logo-{timestamp}.{ext}
 * Returns the public URL for immediate use in the settings form.
 */
export async function uploadBrandingImage(
  formData: FormData,
  type: 'logo' | 'banner',
): Promise<ActionResult<{ url: string }>> {
  const staff = await resolveStaffTenantId();
  if (!staff) return { ok: false, error: 'No access to this restaurant', code: 'forbidden' };

  const file = formData.get('file') as File | null;
  if (!file) return { ok: false, error: 'No file provided', code: 'validation' };

  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: 'Only JPG, PNG, and WebP images are allowed',
      code: 'validation',
    };
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (MAX_FILE_SIZE / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      error: `File must be smaller than ${sizeMB}MB`,
      code: 'validation',
    };
  }

  try {
    const service = createServiceClient();
    const timestamp = Date.now();
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${staff.tenantId}/${type}-${timestamp}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await service.storage
      .from(BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return {
        ok: false,
        error: 'Upload failed. Please try again.',
        code: 'gateway',
      };
    }

    // Build public URL
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) {
      return {
        ok: false,
        error: 'Upload completed but URL could not be generated',
        code: 'unknown',
      };
    }

    const url = `${base}/storage/v1/object/public/${BUCKET}/${path}`;

    return { ok: true, data: { url } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Upload failed',
      code: 'unknown',
    };
  }
}
