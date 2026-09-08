/**
 * POST /api/demo/[tenantId]/logo
 *
 * Upload a logo for a demo fallback storefront.
 * Stores logo in tenant branding and updates fallback state.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { recordLogoUpload } from '@/lib/demo/fallback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  try {
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

    // Verify tenant exists and is a fallback
    const tenant = await db.from('tenants').select('id').eq('id', tenantId).single();
    if (tenant.error || !tenant.data) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
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
        logo_url: publicUrl.publicUrl,
        uploaded_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logo upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
