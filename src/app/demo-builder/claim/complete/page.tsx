import { createServiceClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { ClaimForm } from '@/components/claim/claim-form';
import { AutoRefresh } from '@/components/claim/auto-refresh';
import { BookingLink } from '@/components/claim/booking-link';
import { CLAIM_SESSION_COOKIE } from '@/lib/claims/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Confirm Account - Vardr',
  description: 'Payment confirmed. Complete your account setup and claim your storefront.',
};

/**
 * Completion page after checkout.
 *
 * Previously gated on a `purchase_id` + `payment_confirmed` query string,
 * which only Stripe's per-session success_url could fill in - a GHL
 * Payment Link has one fixed redirect URL shared by every buyer, so it can
 * never carry those. It also required an already-authenticated Supabase
 * user to render the claim form, which no first-time buyer has yet (that
 * account is exactly what this page's form creates) - so a brand-new
 * buyer landing here after paying could never actually reach the form.
 *
 * Both problems share one fix: trust the same claim-session cookie the
 * package-selection page already trusts, and look up payment status from
 * package_purchases server-side instead of a client-supplied query param.
 * This works identically for Stripe and GHL, and only reads state this
 * server already considers authoritative.
 */
export default async function DemoBuilderClaimCompletePage() {
  const status = await getClaimStatus();

  if (!status) {
    return (
      <Centered title="Link not valid">
        This link has expired or is no longer valid. Please request a new demo link.
      </Centered>
    );
  }

  if (status.paymentConfirmed === 'none') {
    return (
      <Centered title="No payment started yet">
        <a href="/demo-builder/claim" className="underline">
          Choose a plan
        </a>{' '}
        to get your storefront activated.
      </Centered>
    );
  }

  if (status.paymentConfirmed === 'pending') {
    return (
      <Centered title="Confirming your payment...">
        <AutoRefresh seconds={4} />
        This usually takes just a few seconds. This page will refresh on its own - no need to
        pay again.
      </Centered>
    );
  }

  return (
    <main className="min-h-dvh bg-gradient-to-br from-neutral-900 to-neutral-800 px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-12">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Vardr Ordering Platform
          </p>
          <h1 className="mt-2 text-4xl font-bold text-white">{status.name}</h1>
          <p className="mt-2 text-neutral-300">
            Complete your account setup to start taking orders.
          </p>
        </div>

        <div className="mb-8 rounded-lg border border-green-200 bg-green-50 px-6 py-4">
          <p className="text-sm font-medium text-green-900">
            ✓ Payment confirmed! Complete your account below to claim your storefront.
          </p>
        </div>

        <ClaimForm restaurantName={status.name} />

        <div className="mt-8 rounded-lg border border-neutral-300 bg-neutral-700 px-6 py-4">
          <BookingLink
            label="After claiming, schedule your setup walkthrough with our team"
            buttonText="Schedule Setup Walkthrough"
            urlEnvVar="BOOKING_WALKTHROUGH_URL"
            showAfterPayment={false}
          />
        </div>

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

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
        <p className="mt-3 text-neutral-600">{children}</p>
      </div>
    </main>
  );
}

type ClaimStatus = { name: string; paymentConfirmed: 'confirmed' | 'pending' | 'none' };

async function getClaimStatus(): Promise<ClaimStatus | null> {
  const token = (await cookies()).get(CLAIM_SESSION_COOKIE)?.value;
  if (!token) return null;

  const service = createServiceClient();
  const { data } = await service.rpc('verify_claim_token', { p_token: token });
  const claim = data?.[0];
  if (!claim) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: purchase } = await (service as any)
    .from('package_purchases')
    .select('status')
    .eq('tenant_id', claim.tenant_id)
    .maybeSingle();

  const paymentConfirmed =
    purchase?.status === 'confirmed' ? 'confirmed' : purchase ? 'pending' : 'none';

  return { name: claim.name, paymentConfirmed };
}
