/**
 * POST /api/webhooks/ghl
 *
 * Receives the "Payment Received" event from the GHL workflow covering the
 * three restaurant plan payment links (Restaurant Direct / Growth / Growth
 * Plus - see GHLProvider for why the buyer's email, not a passed-through
 * reference id, is what ties this back to a tenant's pending purchase).
 *
 * Auth: a shared secret in the query string (?secret=...), checked against
 * GHL_WEBHOOK_SECRET. GHL's workflow webhook action is configured with a
 * literal URL, so this travels the same way a header would but needs no
 * custom-header support from the workflow builder.
 *
 * Body shape: built to tolerate however the workflow's webhook action ends
 * up shaping its payload (an explicit custom-body mapping, or GHL's default
 * contact/event dump) - it looks for the buyer's email and an optional
 * transaction id under several plausible field names rather than one exact
 * schema, and only ever "succeeds" a request whose email actually matches a
 * pending purchase.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { GHLProvider, type GHLWebhookPayload } from '@/lib/payments/ghl-provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPayload(body: any): GHLWebhookPayload {
  const contact = body?.contact ?? {};
  return {
    contact_email: firstString(
      body?.contact_email,
      body?.email,
      body?.customer_email,
      contact?.email,
    ),
    transaction_id: firstString(
      body?.transaction_id,
      body?.transactionId,
      body?.payment_id,
      body?.paymentId,
      body?.id,
    ),
    package_name: firstString(body?.package_name, body?.product_name, body?.productName),
    amount_cents:
      typeof body?.amount_cents === 'number'
        ? body.amount_cents
        : typeof body?.amount === 'number'
          ? Math.round(body.amount * 100)
          : null,
  };
}

export async function POST(request: NextRequest) {
  const expected = process.env.GHL_WEBHOOK_SECRET;
  if (!expected) {
    console.error('GHL_WEBHOOK_SECRET is not configured; refusing all GHL webhooks');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const provided = request.nextUrl.searchParams.get('secret');
  if (provided !== expected) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const payload = extractPayload(body);
  console.log('GHL payment webhook received:', {
    hasEmail: Boolean(payload.contact_email),
    transaction_id: payload.transaction_id,
    package_name: payload.package_name,
  });

  const provider = new GHLProvider();
  const result = await provider.verifyPaymentConfirmation({ raw_payload: payload });

  // A payment for one of these products with no matching pending purchase
  // is expected and harmless - the public /pricing page sells the exact
  // same products with no tenant attached. Always 200 so GHL doesn't retry
  // an event we understood fine and correctly chose not to act on.
  return NextResponse.json({ received: true, matched: result.success });
}
