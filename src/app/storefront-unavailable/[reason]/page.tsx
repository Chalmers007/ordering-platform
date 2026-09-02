import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

/**
 * Where middleware sends a host it could not turn into a live storefront.
 *
 * A custom domain that was added but never verified lands on `not-found`,
 * which is what stops someone pointing DNS at the platform and being served
 * a tenant's storefront.
 */
const REASONS = {
  'not-found': {
    status: 404,
    title: 'No restaurant here yet',
    body: 'This web address is not connected to a restaurant. If you own it, finish verifying the domain in your dashboard.',
  },
  pending: {
    status: 404,
    title: 'Not open yet',
    body: 'This restaurant is still setting up its online ordering.',
  },
  suspended: {
    status: 503,
    title: 'Temporarily unavailable',
    body: 'Online ordering for this restaurant is paused. Please try again later.',
  },
  cancelled: {
    status: 404,
    title: 'No longer available',
    body: 'This restaurant is no longer taking orders online.',
  },
} as const;

type Reason = keyof typeof REASONS;

function resolve(reason: string) {
  return REASONS[reason as Reason] ?? REASONS['not-found'];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reason: string }>;
}): Promise<Metadata> {
  const { reason } = await params;
  return { title: resolve(reason).title };
}

export default async function StorefrontUnavailablePage({
  params,
}: {
  params: Promise<{ reason: string }>;
}) {
  const { reason } = await params;
  const content = resolve(reason);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
      <div
        className="max-w-md text-center"
        data-reason={reason}
        data-http-status={content.status}
      >
        <h1 className="text-2xl font-semibold text-neutral-900">{content.title}</h1>
        <p className="mt-3 text-neutral-600">{content.body}</p>
      </div>
    </main>
  );
}
