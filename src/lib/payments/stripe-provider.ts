/**
 * Stripe billing provider implementation.
 *
 * Handles:
 * - Free package confirmation
 * - Stripe checkout session creation
 * - Webhook signature verification
 * - Idempotent payment confirmation
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/payments/stripe';
import type {
  BillingProviderImpl,
  PackageCheckoutRequest,
  CheckoutResponse,
  PaymentConfirmationRequest,
  PaymentConfirmation,
} from './provider';
import Stripe from 'stripe';

export class StripeProvider implements BillingProviderImpl {
  private withPurchaseId(url: string, purchaseId: string): string {
    return url.replaceAll('{PURCHASE_ID}', encodeURIComponent(purchaseId));
  }

  async processCheckout(req: PackageCheckoutRequest): Promise<CheckoutResponse> {
    const service = createServiceClient();

    // Free packages: confirm immediately, no Stripe call
    if (!req.price_cents || req.price_cents === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: freePurchase, error: createError } = await (service as any)
        .from('package_purchases')
        .insert({
          tenant_id: req.tenant_id,
          package_id: req.package_id,
          amount_cents: 0,
          status: 'confirmed',
          webhook_received_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Failed to record free package:', createError);
        throw new Error('Could not process selection');
      }

      return {
        type: 'confirmed',
        redirect_url: this.withPurchaseId(req.completion_url, freePurchase.id),
      };
    }

    // Paid packages: create Stripe checkout session
    try {
      const stripe = getStripe();

      // Create pending purchase record first (webhook will confirm it)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const purchaseResult = (await (service as any)
        .from('package_purchases')
        .insert({
          tenant_id: req.tenant_id,
          package_id: req.package_id,
          amount_cents: req.price_cents,
          status: 'pending',
        })
        .select('id')
        .single()) as {
        data: { id: string } | null;
        error: Record<string, unknown> | null;
      };

      if (purchaseResult.error || !purchaseResult.data) {
        console.error('Failed to create purchase record:', purchaseResult.error);
        throw new Error('Could not start checkout');
      }

      const purchase = purchaseResult.data;

      // Create Stripe checkout session
      // Note: claim_token is NOT stored in metadata anymore
      // Instead, use internal_reference_id (purchase_id) for binding
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        client_reference_id: purchase.id,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: req.package_name,
                description: 'Restaurant package - Vardr Ordering Platform',
              },
              unit_amount: req.price_cents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          tenant_id: req.tenant_id,
          package_id: req.package_id,
          purchase_id: purchase.id,
          intent: 'package_purchase',
          // NEVER store claim_token here
        },
        success_url: this.withPurchaseId(req.completion_url, purchase.id),
        cancel_url: this.withPurchaseId(req.cancel_url, purchase.id),
      });

      if (!session.url) {
        throw new Error('Stripe checkout failed');
      }

      return {
        type: 'checkout_url',
        checkout_url: session.url,
        provider_reference_id: session.id,
      };
    } catch (err) {
      console.error('Stripe checkout error:', err);
      throw new Error('Payment processing unavailable');
    }
  }

  async verifyPaymentConfirmation(
    req: PaymentConfirmationRequest,
  ): Promise<PaymentConfirmation> {
    // This is called by the Stripe webhook handler
    // The webhook handler handles signature verification via constructWebhookEvent
    // This method just processes the confirmed event

    const event = req.raw_payload as Stripe.Event;

    if (event.type !== 'payment_intent.succeeded') {
      return {
        success: false,
        error: 'Unsupported event type',
      };
    }

    const intent = event.data.object as Stripe.PaymentIntent;
    const metadata = intent.metadata;

    if (!metadata?.purchase_id) {
      return {
        success: false,
        error: 'No purchase_id in metadata',
      };
    }

    try {
      const service = createServiceClient();

      // Update purchase_purchases record with confirmed status
      // The webhook handler already verified the signature
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (service as any)
        .from('package_purchases')
        .update({
          status: 'confirmed',
          stripe_payment_intent_id: intent.id,
          webhook_received_at: new Date().toISOString(),
        })
        .eq('id', metadata.purchase_id);

      if (updateError) {
        console.error('Failed to update package_purchases:', updateError);
        return {
          success: false,
          error: 'Could not confirm payment',
        };
      }

      return {
        success: true,
        internal_reference_id: metadata.purchase_id,
        provider_reference_id: intent.id,
      };
    } catch (err) {
      console.error('Payment confirmation error:', err);
      return {
        success: false,
        error: 'Payment confirmation failed',
      };
    }
  }
}
