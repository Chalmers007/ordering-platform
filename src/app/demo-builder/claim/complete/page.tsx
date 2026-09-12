import { createServiceClient } from '@/lib/supabase/server';
import { createClientForRequest } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ClaimForm } from '@/components/claim/claim-form';
import { BookingLink } from '@/components/claim/booking-link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Confirm Account - Vardr',
  description: 'Payment confirmed. Complete your account setup and claim your storefront.',
};

/**
 * Completion page after successful payment.
 *
 * Shows payment confirmation, account creation form, and booking options.
 * The payment return URL contains only an opaque purchase id. The claim token
 * is resolved server-side after confirmed payment.
 */
export default async function DemoBuilderClaimCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ purchase_id?: string; payment_confirmed?: string }>;
}) {
  const { purchase_id, payment_confirmed } = await searchParams;
  const claim = purchase_id && UUID.test(purchase_id) ? await verifyPurchase(purchase_id) : null;

  // Claimed owners return to the authenticated dashboard.  `/setup` is not
  // an owner route and would otherwise turn a verified payment into a 404.
  if (claim?.claimed) redirect('/app/setup');

  if (!claim || !payment_confirmed) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">
            {!payment_confirmed ? 'Payment not confirmed' : 'Link not valid'}
          </h1>
          <p className="mt-3 text-neutral-600">
            {!payment_confirmed
              ? 'Please complete your payment to continue.'
              : 'This link has expired or is no longer valid. Please request a new demo link.'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gradient-to-br from-neutral-900 to-neutral-800 px-6 py-12">
      {/* Vardr branding header */}
      <div className="mx-auto max-w-2xl">
        <div className="mb-12">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Vardr Ordering Platform
          </p>
          <h1 className="mt-2 text-4xl font-bold text-white">{claim.name}</h1>
          <p className="mt-2 text-neutral-300">
            Complete your account setup to start taking orders.
          </p>
        </div>

        {/* Payment confirmed banner */}
        <div className="mb-8 rounded-lg border border-green-200 bg-green-50 px-6 py-4">
          <p className="text-sm font-medium text-green-900">
            ✓ Payment confirmed! Complete your account below to claim your storefront.
          </p>
        </div>

        {/* Account creation form */}
        <ClaimForm restaurantName={claim.name} />

        {/* Setup walkthrough */}
        <div className="mt-8 rounded-lg border border-neutral-300 bg-neutral-700 px-6 py-4">
          <BookingLink
            label="After claiming, schedule your setup walkthrough with our team"
            buttonText="Schedule Setup Walkthrough"
            urlEnvVar="BOOKING_WALKTHROUGH_URL"
            showAfterPayment={false}
          />
        </div>

        {/* Questions option */}
        <div className="mt-6 border-t border-neutral-600 pt-6">
          <BookingLink
            label="Have questions?"
            buttonText="Book a Call"
            urlEnvVar="BOOKING_QUESTIONS_URL"
            showAfterPayment={false}
          />
        </div>
      </div>
    </main>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyPurchase(purchaseId: string) {
  const service = createServiceClient();
  // Service role reads the token only to render the existing claim form after
  // Stripe has confirmed this opaque purchase. It is never in Stripe/GHL data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: purchase } = await (service as any)
    .from('package_purchases')
    .select('tenant_id, status')
    .eq('id', purchaseId)
    .eq('status', 'confirmed')
    .maybeSingle();
  if (!purchase) return null;
  const requestClient = await createClientForRequest();
  const { data: { user } } = await requestClient.auth.getUser();
  if (!user) return null;
  const { data: profile } = await service.from('user_profiles').select('tenant_id, role').eq('id', user.id).maybeSingle();
  if (!profile || profile.tenant_id !== purchase.tenant_id || profile.role !== 'tenant_owner') return null;
  const { data: tenant } = await service.from('tenants').select('name').eq('id', purchase.tenant_id).maybeSingle();
  return tenant ? { name: tenant.name, claimed: true } : null;
}
