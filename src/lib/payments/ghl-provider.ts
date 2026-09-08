/**
 * GHL (GoHighLevel) billing provider implementation.
 *
 * PLACEHOLDER: Not yet activated. Requires:
 * - GHL payment link configuration for each package
 * - GHL webhook event contract for payment confirmation
 * - Secure opaque reference binding (purchase_id, not claim_token)
 * - GHL API credentials in secure environment
 *
 * This provider is prepared but DISABLED until the above are verified.
 */

import type {
  BillingProviderImpl,
  CheckoutResponse,
  PaymentConfirmation,
} from './provider';

export class GHLProvider implements BillingProviderImpl {
  async processCheckout(): Promise<CheckoutResponse> {
    // PLACEHOLDER: Not yet implemented
    // Required: GHL payment link URLs for Starter, Professional, Enterprise
    // Required: Mechanism to bind payment confirmation to package_purchase_id

    throw new Error(
      'GHL billing provider is not yet configured. ' +
        'Required: GHL payment links, webhook configuration, and secure binding strategy.',
    );
  }

  async verifyPaymentConfirmation(): Promise<PaymentConfirmation> {
    // PLACEHOLDER: Not yet implemented
    // Required: GHL webhook signature verification
    // Required: GHL payment event contract and field names
    // Required: Opaque internal reference field (purchase_id)

    throw new Error(
      'GHL payment confirmation is not yet configured. ' +
        'Required: GHL webhook signature secret and event schema.',
    );
  }
}

/**
 * Configuration required for GHL billing:
 *
 * Environment Variables (secure, not to be printed):
 * - GHL_API_KEY: GoHighLevel API credentials
 * - GHL_WEBHOOK_SECRET: GHL webhook signing secret (for payment-confirmed events)
 * - GHL_LOCATION_ID: Holden Solutions location ID in GHL
 *
 * GHL Configuration (in GoHighLevel console):
 * - Starter ($0) payment link/product
 * - Professional ($99.99) payment link/product
 * - Enterprise (contact) contact path
 * - Payment-success webhook targeting /api/webhooks/ghl
 * - Custom field or metadata: opaque reference to package_purchase_id
 * - Questions-call calendar (use existing if available)
 * - Setup-walkthrough calendar (use existing if available)
 *
 * GHL Webhook Event:
 * - Endpoint: POST /api/webhooks/ghl
 * - Signature header: TBD (document the exact header name)
 * - Payload: TBD (document the exact event structure, reference field)
 * - Must include: payment_status='confirmed', internal_reference_id or equivalent
 * - Must NOT include: claim_token
 *
 * Deployment:
 * - GHL provider remains disabled until all above are configured
 * - Deployment to staging requires BILLING_PROVIDER=ghl + all env vars + verified webhooks
 * - Stripe remains active as fallback during GHL integration testing
 */
