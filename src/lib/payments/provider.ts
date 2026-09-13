/**
 * Billing provider interface.
 *
 * Supports multiple payment backends (Stripe, GHL, etc).
 * Each provider handles:
 * - Free package confirmation
 * - Paid package checkout initiation
 * - Payment confirmation callback processing
 * - Opaque internal reference binding (never claim_token)
 */

export type BillingProvider = 'stripe' | 'ghl';

export interface PackageCheckoutRequest {
  tenant_id: string;
  package_id: string;
  package_name: string;
  price_cents: number | null;
  /** Opaque internal ID (purchase_id, never claim_token) */
  internal_reference_id: string;
  /** Full URL to claim completion page. Provider fills in own params. */
  completion_url: string;
  /** Full URL to return to package selection. Provider fills in own params. */
  cancel_url: string;
  /**
   * Buyer's email, captured before checkout. Stripe doesn't need this (its
   * session carries its own reference back to us); GHL payment links do -
   * this is the only thing that lets the payment-confirmed webhook find its
   * way back to this specific tenant's pending purchase.
   */
  customer_email?: string;
}

export interface CheckoutResponse {
  type: 'confirmed' | 'checkout_url' | 'payment_link_url';
  /** For free packages: redirect URL to claim completion */
  redirect_url?: string;
  /** For Stripe: checkout session URL */
  checkout_url?: string;
  /** For GHL: payment link URL (if supported) */
  payment_link_url?: string;
  /** Provider-specific session/reference ID */
  provider_reference_id?: string;
}

export interface PaymentConfirmationRequest {
  /** Provider-specific payload (webhook body or query params) */
  raw_payload: unknown;
  /** Provider-specific signature/header */
  signature?: string;
}

export interface PaymentConfirmation {
  success: boolean;
  internal_reference_id?: string;
  provider_reference_id?: string;
  error?: string;
}

export interface BillingProviderImpl {
  /**
   * Process a free or paid package checkout.
   * - Free packages: create purchase_purchases record with status='confirmed'
   * - Paid packages: initiate checkout, return URL or error
   */
  processCheckout(req: PackageCheckoutRequest): Promise<CheckoutResponse>;

  /**
   * Verify and process a payment confirmation.
   * - Validate signature/authenticity
   * - Idempotent: duplicate events return same result
   * - Update package_purchases.status='confirmed'
   * - Return opaque internal reference for claim verification
   */
  verifyPaymentConfirmation(
    req: PaymentConfirmationRequest,
  ): Promise<PaymentConfirmation>;
}

/**
 * Get active billing provider implementation.
 * Defaults to 'stripe' unless overridden via BILLING_PROVIDER env var.
 */
export function getActiveBillingProvider(): BillingProvider {
  const provider = (process.env.BILLING_PROVIDER || 'stripe') as BillingProvider;
  if (provider !== 'stripe' && provider !== 'ghl') {
    throw new Error(`Invalid BILLING_PROVIDER: ${provider}`);
  }
  return provider;
}
