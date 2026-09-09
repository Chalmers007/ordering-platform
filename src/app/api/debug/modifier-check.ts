import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  const db = createServiceClient();

  // Check modifier groups
  const { data: groups } = await db
    .from('menu_modifier_groups')
    .select('id, name, selection_type, is_active')
    .eq('tenant_id', tenantId);

  // Check modifiers for each group
  const groupDetails = [];
  for (const group of groups || []) {
    const { data: modifiers } = await db
      .from('menu_modifiers')
      .select('id, name, price_delta_cents, sort_order')
      .eq('group_id', group.id);

    groupDetails.push({
      ...group,
      modifierCount: modifiers?.length || 0,
      modifiers: modifiers,
    });
  }

  return NextResponse.json({
    tenantId,
    groupCount: groups?.length || 0,
    groups: groupDetails,
  });
}
