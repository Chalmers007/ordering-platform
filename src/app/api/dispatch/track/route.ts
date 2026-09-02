import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClientForRequest } from '@/lib/supabase/server';
import { refreshCourierLocation } from '@/lib/dispatch/tracking';
import {
  toTrackingResponse,
  type TrackingResponse,
  type TrackingRow,
} from '@/lib/dispatch/tracking-response';

export type { TrackingResponse };

/**
 * White-labelled tracking.
 *
 * Authorisation first: `get_delivery_tracking()` returns a row only to the
 * order's owner, the restaurant's staff, or a holder of the order's tracking
 * token. Only then may the courier be refreshed — and the courier's identity,
 * key and job reference never appear in the response.
 *
 * The response shape is fixed and allow-listed. It is built field by field
 * rather than by spreading a database row, so a column added later cannot
 * leak by accident.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    orderId: z.string().uuid().optional(),
    token: z.string().uuid().optional(),
  })
  .refine((q) => Boolean(q.orderId) !== Boolean(q.token), {
    message: 'Provide exactly one of orderId or token',
  });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    orderId: request.nextUrl.searchParams.get('orderId') ?? undefined,
    token: request.nextUrl.searchParams.get('token') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Provide exactly one of orderId or token' },
      { status: 400 },
    );
  }

  const supabase = await createClientForRequest();
  const { data, error } = await supabase.rpc('get_delivery_tracking', {
    p_order_id: parsed.data.orderId ?? undefined,
    p_token: parsed.data.token ?? undefined,
  });

  if (error) {
    return NextResponse.json({ error: 'Tracking is unavailable' }, { status: 500 });
  }

  const row = data?.[0];
  if (!row) {
    // Deliberately indistinguishable from "not yours": a 403 here would let
    // someone probe which order ids exist.
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Refresh only while the order is actually in motion.
  const inFlight =
    row.fulfillment_type === 'delivery' &&
    row.delivery_status !== null &&
    !['delivered', 'failed', 'cancelled'].includes(row.delivery_status);

  let current = row;
  if (inFlight && row.has_external_ref) {
    const changed = await refreshCourierLocation(row.order_id);
    if (changed) {
      const { data: refreshed } = await supabase.rpc('get_delivery_tracking', {
        p_order_id: parsed.data.orderId ?? undefined,
        p_token: parsed.data.token ?? undefined,
      });
      current = refreshed?.[0] ?? row;
    }
  }

  // Allow-listed shaping. `current` still carries has_external_ref, which is
  // exactly the sort of field that must never reach a browser.
  const body = toTrackingResponse(current as unknown as TrackingRow);

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
