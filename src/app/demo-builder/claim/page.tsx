import { createServiceClient } from '@/lib/supabase/server';
import { PackageSelector } from '@/components/claim/package-selector';
import { BookingLink } from '@/components/claim/booking-link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CLAIM_SESSION_COOKIE } from '@/lib/claims/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Get Started - Vardr',
  description: 'Choose your restaurant package and complete the claim process.',
};

/**
 * Vardr-branded claim page with package selection.
 *
 * Reached from demo preview (via "Claim This Storefront" button).
 * Shows packages, booking option, and initiates Stripe checkout.
 * The claim token is held in an HttpOnly cookie and is never serialized into
 * client state, payment metadata, or API responses.
 */
export default async function DemoBuilderClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token) redirect(`/api/claim/session?token=${encodeURIComponent(token)}`);

  const tokenFromCookie = (await cookies()).get(CLAIM_SESSION_COOKIE)?.value;
  const claim = tokenFromCookie ? await verify(tokenFromCookie) : null;

  if (!claim) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">Link not valid</h1>
          <p className="mt-3 text-neutral-600">
            This link has expired or is no longer valid. Please request a new demo link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gradient-to-br from-neutral-900 to-neutral-800 px-6 py-12">
      {/* Vardr branding header */}
      <div className="mx-auto max-w-4xl">
        <div className="mb-12">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Vardr Ordering Platform
          </p>
          <h1 className="mt-2 text-4xl font-bold text-white">{claim.name}</h1>
          <p className="mt-2 text-neutral-300">
            Your preview is ready. Choose a plan and get started.
          </p>
        </div>

        {/* Status banner */}
        <div className="mb-8 rounded-lg border border-yellow-200 bg-yellow-50 px-6 py-4">
          <p className="text-sm font-medium text-yellow-900">
            ⚠️ Demo — not yet live. Orders are disabled until your plan is confirmed.
          </p>
        </div>

        {/* Packages */}
        <PackageSelector tenantId={claim.tenant_id} />

        {/* Questions option */}
        <div className="mt-12 border-t border-neutral-200 pt-8">
          <BookingLink
            label="Have questions about our plans?"
            buttonText="Book a Call"
            urlEnvVar="BOOKING_QUESTIONS_URL"
            showAfterPayment={false}
          />
        </div>

        {/* Setup walkthrough (shown after payment) */}
        <div className="mt-8 hidden" id="setup-walkthrough-section">
          <BookingLink
            label="After purchase, schedule your setup walkthrough"
            buttonText="Schedule Setup Call"
            urlEnvVar="BOOKING_WALKTHROUGH_URL"
            showAfterPayment={true}
          />
        </div>
      </div>
    </main>
  );
}

async function verify(token: string) {
  // Same as existing claim page: verify token server-side, return only safe data
  const service = createServiceClient();
  const { data } = await service.rpc('verify_claim_token', { p_token: token });
  return data?.[0] ?? null;
}
