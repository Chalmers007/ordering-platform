import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';
import { currentPreviewSession } from '@/lib/preview-personalisation/session';
import { PREVIEW_BUCKET } from '@/lib/preview-personalisation/bucket';

/**
 * Serves an image a visitor uploaded to their own preview.
 *
 * The bucket is private, so this is the only way to read one — which is the
 * point. An open upload endpoint whose files are publicly addressable is a
 * free file host on somebody else's domain; here a file is only readable by
 * the browser holding the session cookie that created it.
 *
 * The Content-Type is the one SNIFFED at upload, not the one the caller
 * declared, and `nosniff` stops a browser second-guessing it. Together with
 * refusing SVG entirely, that is what keeps an uploaded file from executing.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse(null, { status: 404, headers: HEADERS });

  const session = await currentPreviewSession(tenant.tenantId);
  if (!session) return new NextResponse(null, { status: 404, headers: HEADERS });

  const db = createServiceClient();
  const { data: asset } = await db
    .from('preview_session_assets')
    .select('storage_path, mime_type')
    // Scoped to the session as well as the id: knowing an asset id is not
    // enough to read it.
    .eq('id', assetId)
    .eq('session_id', session.id)
    .maybeSingle();
  if (!asset) return new NextResponse(null, { status: 404, headers: HEADERS });

  const file = await db.storage.from(PREVIEW_BUCKET).download(asset.storage_path as string);
  if (file.error || !file.data) return new NextResponse(null, { status: 404, headers: HEADERS });

  const bytes = new Uint8Array(await file.data.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: { ...HEADERS, 'Content-Type': asset.mime_type as string, 'Content-Length': String(bytes.length) },
  });
}
