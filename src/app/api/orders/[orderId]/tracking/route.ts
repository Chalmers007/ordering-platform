import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Order tracking API - Customer-facing, uses tracking token instead of auth.
 *
 * Returns: order status, delivery status, courier details, ETA, tracking link.
 * Token-based access prevents customer from seeing other orders.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify token matches order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, tenant_id, tracking_token')
    .eq('id', params.orderId)
    .eq('tracking_token', token)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Get delivery details
  const { data: delivery } = await supabase
    .from('deliveries')
    .select(
      'status, courier_name, courier_phone, courier_latitude, courier_longitude, estimated_delivery_at, tracking_url, updated_at',
    )
    .eq('order_id', params.orderId)
    .maybeSingle();

  return NextResponse.json({
    orderId: order.id,
    orderStatus: order.status,
    status: delivery?.status || 'unassigned',
    courierName: delivery?.courier_name,
    courierPhone: delivery?.courier_phone,
    courierLatitude: delivery?.courier_latitude,
    courierLongitude: delivery?.courier_longitude,
    estimatedDeliveryAt: delivery?.estimated_delivery_at,
    trackingUrl: delivery?.tracking_url,
    lastUpdate: delivery?.updated_at || order.id, // Fallback to creation if no delivery yet
  });
}
