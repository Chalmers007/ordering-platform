import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Kept because links to /orders/<id>/track have already been sent — in
 * checkout redirects and order notifications. A tracking link a customer
 * received must not stop working because the canonical path moved.
 */
export default async function LegacyTrackRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const status = typeof query.status === 'string' ? `?status=${encodeURIComponent(query.status)}` : '';
  redirect(`/orders/${orderId}${status}`);
}
