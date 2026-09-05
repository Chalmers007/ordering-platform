import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { cancelOrderDispatch } from '@/lib/dispatch/cancel-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { orderId } = await request.json();
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  }

  try {
    const result = await cancelOrderDispatch(orderId);

    if (result.cancelled) {
      return NextResponse.json({
        success: true,
        message: 'Delivery cancelled',
        deliveryId: result.deliveryId,
      });
    } else {
      return NextResponse.json(
        { success: false, message: result.reason },
        { status: 400 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cancel failed' },
      { status: 500 },
    );
  }
}
