/**
 * GHL contact sync after payment confirmation.
 *
 * Uses the durable outbox pattern (webhook_events table) for reliable delivery:
 * - Event is persisted immediately (same transaction as payment confirmation)
 * - Stripe payment is confirmed regardless of GHL sync status
 * - Outbox drain attempts delivery immediately + retries with exponential backoff
 * - Idempotency: payment_id prevents duplicate contact/opportunity creation
 * - Timeout: 10 seconds per HTTP attempt
 * - Max attempts: 6 (configured in webhook_events)
 *
 * GHL receives the event via the webhook_events drain (drainWebhookEvents):
 * - Contact/opportunity upsert
 * - Setup walkthrough workflow
 * - Payment confirmation SMS/email
 * - Follow-up based on package tier
 *
 * Stripe is the payment authority; GHL handles CRM, automation, appointments.
 * Package purchase ID is preserved via Stripe client_reference_id.
 */

import { createServiceClient } from '@/lib/supabase/server';
import type { WebhookEventType } from '@/types/database';

export interface PaymentConfirmedEvent {
  /** Internal package_purchase_id (from Stripe client_reference_id) */
  purchase_id: string;
  /** Internal only: used to record the Stripe confirmation, never sent to GHL. */
  stripe_payment_intent_id: string;
  /** Tenant ID (restaurant) */
  tenant_id: string;
  /** Amount paid in cents */
  amount_cents: number;
  /** Package name (for GHL workflow context) */
  package_name: string;
}

/**
 * Queue a payment-confirmed event to GHL via the durable outbox.
 *
 * This inserts into webhook_events, which is drained by:
 * - Immediate drain in the same webhook handler
 * - Periodic drain via scheduler (if configured)
 *
 * The event is persisted before the webhook returns, so it will not be lost
 * if the HTTP delivery fails. It will be retried with exponential backoff.
 *
 * Payment confirmation happens BEFORE this is called, so GHL delivery failure
 * does not undo confirmed payment. GHL events are best-effort, not transactional.
 */
export async function queuePaymentConfirmedToGHL(
  event: PaymentConfirmedEvent,
): Promise<{
  queued: boolean;
  error?: string;
}> {
  const service = createServiceClient();

  // Prepare GHL webhook payload
  // Uses purchase_id as the opaque idempotency/reference key.
  // Never includes claim_token
  const eventPayload = {
    event: 'payment_confirmed',
    purchase_id: event.purchase_id,
    package: event.package_name,
    amount_cents: event.amount_cents,
    timestamp: new Date().toISOString(),
    // GHL workflows will:
    // - Create/update contact
    // - Create opportunity with purchase details
    // - Trigger "setup_walkthrough" workflow
    // - Send payment confirmation SMS/email
    // - Schedule follow-up based on package tier
  };

  // Insert into webhook_events outbox (durable storage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (service as any)
    .from('webhook_events')
    .insert({
      tenant_id: event.tenant_id,
      event_type: 'payment_confirmed' as WebhookEventType,
      payload: eventPayload,
      status: 'pending',
      // Drain service will look up ghl_webhook_url from tenant_secrets
    });

  // A second Stripe event for the same purchase is already represented by the
  // durable payment_confirmed row. The unique database key makes this safe
  // under concurrent webhook delivery.
  if (insertError?.code === '23505') return { queued: true };

  if (insertError) {
    console.error('Failed to queue payment_confirmed event to GHL:', insertError);
    return {
      queued: false,
      error: insertError.message,
    };
  }

  return {
    queued: true,
  };
}
