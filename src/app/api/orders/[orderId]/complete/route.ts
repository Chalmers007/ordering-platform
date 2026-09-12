import { NextResponse, type NextRequest } from 'next/server';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';

/** Complete a restaurant-managed delivery after handoff. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const staff = await resolveStaffTenantId();
  if (!staff) return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
  const { orderId } = await params;
  const service = createServiceClient();
  const { data: delivery } = await service
    .from('deliveries')
    .select('provider, status')
    .eq('order_id', orderId)
    .eq('tenant_id', staff.tenantId)
    .maybeSingle();
  if (delivery?.provider) {
    return NextResponse.json({ error: 'This delivery can be completed only after provider confirmation.' }, { status: 409 });
  }
  const db = await createClientForRequest();
  const { data, error } = await db.rpc('advance_order_status', {
    p_order_id: orderId,
    p_to_status: 'completed',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, order: data });
}
