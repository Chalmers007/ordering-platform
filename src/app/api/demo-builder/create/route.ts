/**
 * POST /api/demo-builder/create
 *
 * Create a demo fallback for field sales/platform operators.
 *
 * Input: restaurant name (required), website (optional)
 * Output: tenant_id, preview_url, state, expires_at (for public preview link)
 * Cookie: httpOnly preview session for uploads
 *
 * Reuses existing fallback if name already has one (idempotent on name).
 * Never exposes claim tokens or service keys.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { createFallback } from '@/lib/demo/fallback';
import { ensurePreviewSession } from '@/lib/preview-personalisation/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const createDemoSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().optional().or(z.literal('')),
});

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not set');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

async function findExistingByName(name: string) {
  const db = serviceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any)
    .from('demo_fallback_state')
    .select('tenant_id')
    .eq('name_hash', hashName(name))
    .maybeSingle();

  return result.data?.tenant_id ?? null;
}

function hashName(name: string): string {
  return createHash('sha256').update(name.trim().toLowerCase()).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get('name')?.toString() || '';
    const website = formData.get('website')?.toString() || '';

    const validated = createDemoSchema.parse({
      name,
      website: website || undefined,
    });

    const db = serviceClient();

    // Check for existing fallback with same name
    const existingTenantId = await findExistingByName(validated.name);
    if (existingTenantId) {
      // Reuse existing demo
      const tenant = await db.from('tenants').select('id, slug').eq('id', existingTenantId).single();

      if (tenant.data) {
        const session = await ensurePreviewSession(existingTenantId);
        return NextResponse.json(
          {
            tenant_id: existingTenantId,
            slug: tenant.data.slug,
            preview_url: buildPreviewUrl(tenant.data.slug),
            state: 'reused',
            expires_at: session.expiresAt,
          },
          { status: 200 }
        );
      }
    }

    // Create new fallback
    const fallback = await createFallback({
      name: validated.name,
      category: 'restaurant',
    });

    // Record the name hash so we can find it again
    const nameHash = hashName(validated.name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from('demo_fallback_state')
      .update({ name_hash: nameHash })
      .eq('tenant_id', fallback.tenant_id);

    // Start preview session
    const session = await ensurePreviewSession(fallback.tenant_id);

    // Queue background tasks if website provided
    if (validated.website) {
      // Trigger background scraping (fire and forget)
      queueWebsiteScrape(fallback.tenant_id, validated.website).catch((err) => {
        console.error('Background scrape failed:', err);
      });
    }

    return NextResponse.json(
      {
        tenant_id: fallback.tenant_id,
        slug: fallback.slug,
        preview_url: fallback.preview_url,
        state: fallback.state,
        expires_at: session.expiresAt,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', issues: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to create demo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function queueWebsiteScrape(tenantId: string, website: string): Promise<void> {
  // Background scraping would be implemented via a job queue or webhook.
  // For MVP, this is a placeholder that logs intent.
  console.log(`Queued website scrape for tenant ${tenantId}: ${website}`);
}

function buildPreviewUrl(slug: string): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'order.example';
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${slug}.${root}`;
}
