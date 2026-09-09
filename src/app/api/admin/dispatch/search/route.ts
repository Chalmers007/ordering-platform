import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ orders: [] });
  }

  const supabase = createServiceClient();

  // Search by order ID, phone, or email
  const { data: orders } = await (supabase as ReturnType<typeof createServiceClient>)
    .from('deliveries')
    .select(
      `
      id,
      order_id,
      status,
      attempts,
      failure_reason,
      courier_name,
      created_at,
      updated_at,
      external_ref,
      orders(id, customer_id, customer_email, customer_phone)
    `,
    )
    .or(
      `order_id.ilike.%${q}%,orders.customer_email.ilike.%${q}%,orders.customer_phone.ilike.%${q}%`,
    )
    .order('updated_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    orders: (orders || []).map((d: {
      order_id: string;
      orders?: Array<{ customer_id: string }>;
      id: string;
      status: string;
      attempts: number | null;
      failure_reason: string | null;
      courier_name: string | null;
      created_at: string;
      updated_at: string;
    }) => ({
      orderId: d.order_id,
      customerId: d.orders?.[0]?.customer_id,
      deliveryId: d.id,
      status: d.status,
      attempts: d.attempts || 0,
      lastError: d.failure_reason,
      courierName: d.courier_name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
  });
}
