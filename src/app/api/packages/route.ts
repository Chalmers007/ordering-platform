/**
 * GET /api/packages
 *
 * List active restaurant packages available during claim flow.
 * Public endpoint (no auth required).
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const service = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (service as any)
      .from('packages')
      .select('id, name, description, price_cents, features')
      .eq('is_active', true)
      .order('price_cents', { ascending: true, nullsFirst: false })) as {
        data: Array<{ id: string; name: string; description: string; price_cents: number | null; features: string | null }> | null;
        error: Record<string, unknown> | null;
      };

    if (error) {
      console.error('Packages query error:', error);
      return NextResponse.json(
        { error: 'Could not load packages' },
        { status: 500 }
      );
    }

    return NextResponse.json({ packages: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error('Packages endpoint error:', err);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    );
  }
}
