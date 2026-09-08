/**
 * Add payment_confirmed webhook event type for GHL post-payment sync.
 *
 * After Stripe confirms package purchase payment, a payment_confirmed event
 * is queued to webhook_events and drained to the tenant's GHL webhook URL.
 * This triggers GHL workflows for contact/opportunity creation, setup walkthrough,
 * and payment confirmation notifications.
 */

alter type public.webhook_event_type add value if not exists 'payment_confirmed';
