import { createServiceClient } from '@/lib/supabase/server';
import { ClaimForm } from '@/components/claim/claim-form';

export const dynamic = 'force-dynamic';

/**
 * Storefront claim.
 *
 * Lives at the root rather than under /store because the proxy passes
 * /claim through without a surface rewrite — this page has to work on a
 * tenant that is deliberately not yet active, which every other storefront
 * route refuses to serve.
 *
 * Verification runs server-side so an invalid token never reaches the
 * browser with anything attached to it, and a valid one reveals only the
 * restaurant being claimed.
 */
export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const claim = token && UUID.test(token) ? await verify(token) : null;

  if (!claim) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">This link is not valid</h1>
          <p className="mt-3 text-neutral-600">
            Claim links expire, and each one can only be used once. If your restaurant has not
            been set up yet, ask us for a fresh link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6 py-10">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Claim your storefront
          </p>
          <h1 className="mt-1 text-2xl font-bold text-neutral-900">{claim.name}</h1>
          <p className="mt-2 text-neutral-600">
            We have already built your online ordering page — {claim.item_count} item
            {claim.item_count === 1 ? '' : 's'} across {claim.category_count} categor
            {claim.category_count === 1 ? 'y' : 'ies'}. Create your account to take it over and
            start taking orders.
          </p>
          <p className="mt-2 text-sm text-neutral-500">
            {claim.slug}.{process.env.NEXT_PUBLIC_ROOT_DOMAIN}
          </p>
        </div>

        <div className="mt-6">
          <ClaimForm token={token!} restaurantName={claim.name} />
        </div>

        {claim.expires_at ? (
          <p className="mt-4 text-center text-xs text-neutral-500">
            This link expires on{' '}
            {new Date(claim.expires_at).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            .
          </p>
        ) : null}
      </div>
    </main>
  );
}

async function verify(token: string) {
  // Service role because the tenant is not active, so no client role can
  // see the row. The function returns a name and two counts — never the
  // token, and never another tenant.
  const service = createServiceClient();
  const { data } = await service.rpc('verify_claim_token', { p_token: token });
  return data?.[0] ?? null;
}
