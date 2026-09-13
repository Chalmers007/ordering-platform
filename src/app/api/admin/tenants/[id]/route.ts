import { NextResponse, type NextRequest } from 'next/server';
import { createClientForRequest } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/guard';

/**
 * DELETE /api/admin/tenants/[id]
 *
 * Removes a restaurant entirely. Every tenant-scoped table references
 * tenants(id) on delete cascade, so one delete here clears settings, menu,
 * orders, webhook history and demo/fallback state with it — there is no
 * "soft" version of this for a test or duplicate entry, only for a real
 * restaurant that should instead be suspended (status column), not deleted.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }

  const supabase = await createClientForRequest();

  const { data, error } = await supabase.from('tenants').delete().eq('id', id).select('id, name').maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: data }, { status: 200 });
}
