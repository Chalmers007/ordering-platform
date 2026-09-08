/**
 * POST /api/webhooks/ghl
 *
 * GHL payment confirmation is deliberately not an active integration.
 *
 * PLACEHOLDER: Not yet activated. Requires:
 * - GHL webhook signature secret in environment
 * - GHL payment event contract documentation
 * - Secure binding of payment to package_purchase_id
 *
 * This endpoint structure is prepared but disabled until GHL
 * payment configuration is verified.
 */

import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: 'GHL payment webhooks are disabled; Stripe is authoritative' },
    { status: 410 },
  );
}

/**
 * GHL webhook integration requirements:
 *
 * Environment Variables (secure):
 * - GHL_API_KEY: GoHighLevel API key
 * - GHL_WEBHOOK_SECRET: GHL webhook signing secret
 * - GHL_LOCATION_ID: Holden Solutions location ID
 *
 * GHL Webhook Configuration (in GoHighLevel console):
 * - Event trigger: Payment confirmed / Payment successful
 * - Webhook URL: https://<tenant>.order.vardrsystems.com/api/webhooks/ghl
 * - Signature header: TBD (document the exact header: X-GHL-Signature? X-Webhook-Signature?)
 * - Signature algorithm: TBD (HMAC-SHA256?)
 * - Payload fields required:
 *   - payment_status: 'confirmed'
 *   - payment_id or similar (provider_reference_id)
 *   - custom field or metadata: opaque reference_id (package_purchase_id)
 *   - transaction_id: for idempotency
 *   - amount_cents: for verification
 * - Must NOT include: claim_token
 *
 * Expected Payload Structure (PLACEHOLDER, to be confirmed):
 * {
 *   "event": "payment.confirmed",
 *   "payment_id": "ghl_payment_123",
 *   "amount_cents": 9999,
 *   "reference": "purchase_id_uuid",
 *   "timestamp": 1234567890,
 *   "signature": "hmac_hash"
 * }
 *
 * Processing Logic (to be implemented):
 * 1. Verify signature using GHL_WEBHOOK_SECRET
 * 2. Extract reference (package_purchase_id)
 * 3. Update package_purchases SET status='confirmed' WHERE id='reference'
 * 4. Store payment_id for idempotency check
 * 5. Return 200 { received: true }
 * 6. Idempotency: if payment_id already processed, return 200 (no double-update)
 */
