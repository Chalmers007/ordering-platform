import { notFound } from 'next/navigation';
import { CheckoutReturn } from '@/components/storefront/checkout-return';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where Stripe sends the customer after payment.
 *
 * The order is created by the webhook, which may not have arrived yet — so
 * this page waits for it rather than 404ing on a race it knows about.
 */
export default async function CheckoutReturnPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();

  return <CheckoutReturn sessionId={sessionId} />;
}
