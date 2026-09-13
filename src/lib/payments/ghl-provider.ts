/**
 * GHL (GoHighLevel) billing provider implementation.
 *
 * Restaurant plans are sold through three public GHL Payment Links
 * (fastpaydirect.com) - the same links used on the public marketing
 * /pricing page. Those links are static: unlike a Stripe Checkout Session,
 * one link is shared by every buyer and cannot be minted per-request with
 * a custom success URL or embedded reference id.
 *
 * That rules out the pattern StripeProvider uses (a `{PURCHASE_ID}`
 * templated into a one-time success_url). Instead:
 *
 * 1. processCheckout() records a pending package_purchases row keyed by
 *    (tenant_id, customer_email) and hands back the package's fixed
 *    payment link. tenant_id is already unique on package_purchases, so
 *    this is an upsert, not a plain insert - a second attempt (after a
 *    cancel, or clicking twice) must not collide.
 * 2. The buyer pays on GHL's own domain and lands back on
 *    /demo-builder/claim/complete via the payment link's own configured
 *    redirect (set once in the GHL dashboard, not per-request) - that page
 *    reads the tenant from the claim-session cookie, not from a URL param.
 * 3. A GHL workflow (Payment Received, one trigger per plan) posts to
 *    /api/webhooks/ghl with the paying contact's email. That handler is
 *    verifyPaymentConfirmation() below, matching on customer_email against
 *    the pending row for that package and flipping it to 'confirmed'.
 *
 * The email match is the whole trust boundary here, so processCheckout
 * requires one - there is no anonymous GHL checkout in this flow.
 */

import { createServiceClient } from '@/lib/supabase/server';
import type {
  BillingProviderImpl,
  CheckoutResponse,
  PackageCheckoutRequest,
  PaymentConfirmation,
  PaymentConfirmationRequest,
} from './provider';

export interface GHLWebhookPayload {
  contact_email?: string | null;
  transaction_id?: string | null;
  package_name?: string | null;
  amount_cents?: number | null;
}

export class GHLProvider implements BillingProviderImpl {
  async processCheckout(req: PackageCheckoutRequest): Promise<CheckoutResponse> {
    const email = req.customer_email?.trim().toLowerCase();
    if (!email) {
      throw new Error('An email is required to check out');
    }

    const service = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkgResult = (await (service as any)
      .from('packages')
      .select('id, name, ghl_payment_link_url')
      .eq('id', req.package_id)
      .eq('is_active', true)
      .single()) as {
        data: { id: string; name: string; ghl_payment_link_url: string | null } | null;
        error: unknown;
      };

    const pkg = pkgResult.data;
    if (!pkg?.ghl_payment_link_url) {
      throw new Error('This package is not set up for GHL checkout');
    }

    // Free packages don't apply to the GHL restaurant plans (all are paid),
    // but honor the same "confirmed immediately" contract Stripe uses, in
    // case a $0 package is ever added.
    if (!req.price_cents || req.price_cents === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (service as any).from('package_purchases').upsert(
        {
          tenant_id: req.tenant_id,
          package_id: req.package_id,
          customer_email: email,
          amount_cents: 0,
          status: 'confirmed',
          webhook_received_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' },
      );
      if (error) {
        console.error('Failed to record free package (GHL):', error);
        throw new Error('Could not process selection');
      }
      return { type: 'confirmed', redirect_url: req.completion_url };
    }

    // Upsert on tenant_id (unique): re-checking out after a cancel, or a
    // double-click, updates the same pending row rather than failing on a
    // duplicate-key error the way a plain insert would.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any).from('package_purchases').upsert(
      {
        tenant_id: req.tenant_id,
        package_id: req.package_id,
        customer_email: email,
        amount_cents: req.price_cents,
        status: 'pending',
        // Clear any stale confirmation from a prior package if they switch plans.
        webhook_received_at: null,
        ghl_transaction_id: null,
      },
      { onConflict: 'tenant_id' },
    );

    if (error) {
      console.error('Failed to record pending purchase (GHL):', error);
      throw new Error('Could not start checkout');
    }

    return {
      type: 'payment_link_url',
      payment_link_url: pkg.ghl_payment_link_url,
    };
  }

  async verifyPaymentConfirmation(
    req: PaymentConfirmationRequest,
  ): Promise<PaymentConfirmation> {
    const payload = req.raw_payload as GHLWebhookPayload;
    const email = payload.contact_email?.trim().toLowerCase();

    if (!email) {
      return { success: false, error: 'No contact email in webhook payload' };
    }

    const service = createServiceClient();

    // Idempotency: a transaction id we've already recorded means this is a
    // retried delivery of an event we already processed.
    if (payload.transaction_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: already } = await (service as any)
        .from('package_purchases')
        .select('id')
        .eq('ghl_transaction_id', payload.transaction_id)
        .maybeSingle();
      if (already) {
        return { success: true, internal_reference_id: already.id, provider_reference_id: payload.transaction_id };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pending, error: findError } = await (service as any)
      .from('package_purchases')
      .select('id, tenant_id')
      .eq('customer_email', email)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('GHL webhook lookup failed:', findError);
      return { success: false, error: 'Could not look up pending purchase' };
    }

    if (!pending) {
      // Not every Payment Received event is one of ours - the same GHL
      // products are sold from the public marketing page with no tenant
      // attached. Nothing to confirm; not an error.
      return { success: false, error: 'No matching pending purchase' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (service as any)
      .from('package_purchases')
      .update({
        status: 'confirmed',
        ghl_transaction_id: payload.transaction_id ?? null,
        webhook_received_at: new Date().toISOString(),
      })
      .eq('id', pending.id);

    if (updateError) {
      console.error('Failed to confirm GHL purchase:', updateError);
      return { success: false, error: 'Could not confirm payment' };
    }

    return {
      success: true,
      internal_reference_id: pending.id,
      provider_reference_id: payload.transaction_id ?? undefined,
    };
  }
}
