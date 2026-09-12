/**
 * POST /api/demo/[tenantId]/menu
 *
 * Upload or replace menu for a demo fallback storefront.
 * Requires a valid preview session for the tenant (set via cookie when visiting preview URL).
 *
 * Accepts:
 * - JSON menu object with categories/items
 * - Menu file (PDF/image) — parsed by existing scraper
 * - Manual menu entry
 *
 * Replaces sample menu items and marks as source='owner'.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { recordMenuUpload } from '@/lib/demo/fallback';
import { parseRestaurant } from '@/lib/scraper/parse-and-stage';
import { validateMenuFile } from '@/lib/demo/validate-input-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PREVIEW_COOKIE = 'preview_session';

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

interface MenuItem {
  name: string;
  description?: string;
  priceCents: number;
}

interface MenuCategory {
  name: string;
  items: MenuItem[];
}

const menuPayloadSchema = z.object({
  categories: z.array(
    z.object({
      name: z.string().min(1).max(100),
      items: z.array(
        z.object({
          name: z.string().min(1).max(200),
          description: z.string().max(500).optional(),
          priceCents: z.number().int().min(0).max(999999),
        }),
      ),
    }),
  ),
});

/** Verify the request has a valid preview session for this tenant. */
async function authorizePreviewSession(tenantId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  // Get the preview session token from httpOnly cookie
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (!token) {
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

  if (error || !session) {
    return { ok: false, status: 401, error: 'Invalid or expired session' };
  }

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

    const db = await serviceClient();

    // Verify tenant exists
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

    const contentType = request.headers.get('content-type') || '';
    let menu: MenuCategory[] = [];

    if (contentType.includes('application/json')) {
      // JSON menu submission
      const body = await request.json();
      const validated = menuPayloadSchema.parse(body);
      menu = validated.categories;
    } else if (contentType.includes('multipart/form-data')) {
      // File-based menu (parse using existing scraper)
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'File is required' }, { status: 400 });
      }
      const fileCheck = validateMenuFile(file);
      if (!fileCheck.ok) {
        return NextResponse.json({ error: fileCheck.message }, { status: 400 });
      }

      const content = await file.text();

      try {
        const parsed = await parseRestaurant({
          content,
          sourceUrl: `file://${file.name}`,
          nameHint: null,
        });

        menu = parsed.parsed.categories.map((cat) => ({
          name: cat.name,
          items: cat.items.map((item) => ({
            name: item.name,
            description: item.description ?? undefined,
            priceCents: item.priceCents,
          })),
        }));
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Could not parse menu file';
        return NextResponse.json({ error: `Menu parsing failed: ${message}` }, { status: 400 });
      }
    } else {
      return NextResponse.json(
        { error: 'Content-Type must be application/json or multipart/form-data' },
        { status: 400 },
      );
    }

    // Delete existing sample menu items
    await db.from('menu_items').delete().eq('tenant_id', tenantId).eq('source', 'sample');

    // Write new menu items as source='owner'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemsToInsert: any[] = [];

    for (const category of menu) {
      // Create or get category
      const { data: catData } = await db
        .from('menu_categories')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', category.name)
        .maybeSingle();

      let categoryId = catData?.id;

      if (!categoryId) {
        const slug = category.name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newCat } = await (db as any)
          .from('menu_categories')
          .insert({ tenant_id: tenantId, name: category.name, slug, is_active: true })
          .select('id')
          .single();

        categoryId = newCat?.id;
      }

      if (!categoryId) continue;

      // Add items to batch
      for (const item of category.items) {
        itemsToInsert.push({
          tenant_id: tenantId,
          category_id: categoryId,
          name: item.name,
          description: item.description ?? null,
          price_cents: item.priceCents,
          source: 'owner',
          is_available: true,
        });
      }
    }

    if (itemsToInsert.length > 0) {
      const { error: insertError } = await db.from('menu_items').insert(itemsToInsert);

      if (insertError) {
        return NextResponse.json({ error: `Could not save menu items: ${insertError.message}` }, { status: 500 });
      }
    }

    // Record menu upload in fallback state
    await recordMenuUpload(tenantId);

    return NextResponse.json(
      {
        categories: menu.length,
        items: itemsToInsert.length,
        uploaded_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Menu upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
