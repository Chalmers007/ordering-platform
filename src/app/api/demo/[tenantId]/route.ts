/**
 * GET /api/demo/[tenantId]
 * PATCH /api/demo/[tenantId]
 *
 * Get or update demo fallback status.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { getFallbackStatus } from '@/lib/demo/fallback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  try {
    const fallback = await getFallbackStatus(tenantId);

    if (!fallback) {
      return NextResponse.json({ error: 'Demo fallback not found' }, { status: 404 });
    }

    return NextResponse.json(fallback, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  try {
    const db = await serviceClient();
    const body = await request.json();

    // Update tenant name if provided
    if ('name' in body && body.name) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).from('tenants').update({ name: body.name }).eq('id', tenantId);
    }

    const fallback = await getFallbackStatus(tenantId);
    return NextResponse.json(fallback, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update demo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
