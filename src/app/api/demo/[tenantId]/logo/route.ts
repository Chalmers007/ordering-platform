/**
 * POST /api/demo/[tenantId]/logo
 *
 * Upload a logo for a demo fallback storefront.
 * Requires a valid preview session for the tenant (set via cookie when visiting preview URL).
 * Stores logo in tenant branding and updates fallback state.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { recordLogoUpload } from '@/lib/demo/fallback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PREVIEW_COOKIE = 'preview_session';

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** Verify the request has a valid preview session for this tenant. */
async function authorizePreviewSession(tenantId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  // Get the preview session token from httpOnly cookie
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  console.log('[logo-route] checking auth - token present:', !!token);
  if (!token) {
    console.log('[logo-route] no preview session cookie found');
    return { ok: false, status: 401, error: 'Preview session not found' };
  }

  // Compute SHA-256 hash of token (same as how it's stored)
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  const db = await serviceClient();

  // Verify session exists, is for this tenant, and hasn't expired
  const { data: session, error } = await db
    .from('preview_sessions')
    .select('id, expires_at')
    .eq('token_hash', tokenHash)
    .eq('tenant_id', tenantId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error('[logo-route] session lookup error:', error.message);
  }
  if (error || !session) {
    console.log('[logo-route] session not found or expired for tenant:', tenantId);
    return { ok: false, status: 401, error: 'Invalid or expired session' };
  }

  console.log('[logo-route] session authorized:', session.id);
  return { ok: true };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  try {
    // Verify authorization: request must have valid preview session for this tenant
    const auth = await authorizePreviewSession(tenantId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 });
    }

    const db = await serviceClient();

    // Verify tenant exists and is a fallback demo
    const tenant = await db.from('tenants').select('id').eq('id', tenantId).single();
    if (tenant.error || !tenant.data) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Verify demo fallback exists for this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallback = await (db as any)
      .from('demo_fallback_state')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!fallback.data) {
      return NextResponse.json({ error: 'Demo fallback not found' }, { status: 404 });
    }

    // Upload logo to storage
    const filename = `logos/${tenantId}/${Date.now()}-${file.name}`;
    const { data: uploadData, error: uploadError } = await db.storage
      .from('tenant-assets')
      .upload(filename, file, { upsert: false, contentType: file.type });

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    // Get public URL
    const { data: publicUrl } = db.storage.from('tenant-assets').getPublicUrl(uploadData.path);

    // Update tenant branding with logo URL
    await db
      .from('tenant_settings')
      .update({ logo_url: publicUrl.publicUrl })
      .eq('tenant_id', tenantId);

    // Record in fallback state
    await recordLogoUpload(tenantId);

    return NextResponse.json(
      {
        success: true,
        uploaded_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logo upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
