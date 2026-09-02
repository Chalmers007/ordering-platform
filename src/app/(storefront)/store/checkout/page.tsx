import { notFound, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { loadStorefront, orderingAvailability } from '@/lib/storefront/data';
import { CheckoutForm } from '@/components/storefront/checkout-form';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const tenant = await getTenantContext();
  if (!tenant) notFound();

  const storefront = await loadStorefront(tenant.tenantId);
  if (!storefront) notFound();

  // A paused kitchen must not present a checkout at all — not a checkout that
  // fails on submit.
  const { canOrder } = orderingAvailability(storefront.settings);
  if (!canOrder) redirect('/');

  return (
    <CheckoutForm
      currency={storefront.tenant.currency}
      acceptsDelivery={storefront.settings.accepts_delivery}
      defaultTipBps={storefront.settings.default_tip_bps}
    />
  );
}
