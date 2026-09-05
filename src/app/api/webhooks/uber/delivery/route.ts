import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Uber Direct delivery status webhook.
 *
 * Uber sends delivery status updates (picked up, en route, delivered, etc.) as POSTs.
 * Each webhook is signed with HMAC-SHA256 using the webhook signing secret.
 *
 * This endpoint:
 * 1. Verifies the webhook signature
 * 2. Extracts the delivery ID and status
 * 3. Calls apply_delivery_event() to update the order and delivery
 * 4. Returns 200 OK so Uber doesn't retry
 */

interface UberDeliveryEvent {
  delivery_id: string;
  status: string;
  dropoff_eta?: string;
  estimated_delivery_at?: string;
  tracking_url?: string;
  courier?: {
    name?: string;
    phone_number?: string;
    latitude?: number;
    longitude?: number;
  };
}

/**
 * Verify Uber webhook signature.
 * Uber signs with: HMAC-SHA256(webhook_body, webhook_signing_secret)
 * Header format: "sha256=<hex_digest>"
 */
function verifyUberSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;

  const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const headerDigest = signature.replace('sha256=', '');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(headerDigest));
}

/**
 * Map Uber delivery status to our status enum.
 */
function mapUberDeliveryStatus(uberStatus: string): string {
  const normalized = uberStatus.toLowerCase().replace(/-/g, '_');
  const map: Record<string, string> = {
    accepted: 'assigned',
    arriving: 'en_route',
    arrived: 'en_route',
    picked_up: 'picked_up',
    pick_up: 'picked_up',
    en_route: 'en_route',
    arriving_soon: 'en_route',
    arrived_at_dropoff: 'en_route',
    completed: 'delivered',
    delivered: 'delivered',
    cancelled: 'cancelled',
    failed: 'failed',
    unable_to_deliver: 'failed',
  };

  return map[normalized] || 'unassigned';
}

export async function POST(request: NextRequest) {
  // Get the raw body for signature verification
  const body = await request.text();
  const signature = request.headers.get('x-uber-signature');

  // Get the webhook signing secret from environment or database
  // For now, we'll use an env var; in production this should come from tenant_secrets
  const webhookSecret = process.env.UBER_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[uber-webhook] No UBER_WEBHOOK_SECRET configured');
    // Don't fail — logging is helpful but a missing secret shouldn't break the webhook
    return NextResponse.json({ ok: true, warning: 'Secret not configured' });
  }

  try {
    // Verify signature
    if (!verifyUberSignature(body, signature, webhookSecret)) {
      console.warn('[uber-webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event: UberDeliveryEvent = JSON.parse(body);

    if (!event.delivery_id) {
      console.warn('[uber-webhook] No delivery_id in event');
      return NextResponse.json({ error: 'Missing delivery_id' }, { status: 400 });
    }

    // Find the delivery and order
    const service = createServiceClient();

    const { data: delivery, error: deliveryError } = await service
      .from('deliveries')
      .select('id, order_id, provider')
      .eq('provider', 'uber_direct')
      .eq('external_ref', event.delivery_id)
      .maybeSingle();

    if (deliveryError || !delivery) {
      console.warn('[uber-webhook] Delivery not found', event.delivery_id, deliveryError?.message);
      // Return 200 so Uber doesn't retry; the delivery may be old or orphaned
      return NextResponse.json({ ok: true });
    }

    // Apply the delivery event
    const status = mapUberDeliveryStatus(event.status);
    const { error: applyError } = await service.rpc('apply_delivery_event', {
      p_provider: 'uber_direct',
      p_external_ref: event.delivery_id,
      p_status: status as any,
      p_courier_name: event.courier?.name,
      p_courier_phone: event.courier?.phone_number,
      p_latitude: event.courier?.latitude,
      p_longitude: event.courier?.longitude,
      p_tracking_url: event.tracking_url,
      p_estimated_delivery_at: event.estimated_delivery_at ?? event.dropoff_eta,
    });

    if (applyError) {
      console.error('[uber-webhook] apply_delivery_event failed', event.delivery_id, applyError.message);
      // Still return 200; don't let database errors cause Uber to retry
      return NextResponse.json({ ok: true, warning: 'Event recorded but update failed' });
    }

    console.log('[uber-webhook] Delivery updated', event.delivery_id, mapUberDeliveryStatus(event.status));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[uber-webhook] Parse or processing error', error);
    // Return 200 anyway; Uber shouldn't retry on our parsing errors
    return NextResponse.json({ ok: true, warning: 'Event received but not processed' });
  }
}
