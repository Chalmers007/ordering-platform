import { notFound, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { isPreviewRequest } from '@/lib/storefront/preview';
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
  // An unclaimed storefront cannot reach checkout even by typing the URL. The
  // menu page hides the controls; this closes the direct route, and price_cart
  // would refuse underneath both.
  if (!canOrder || (await isPreviewRequest())) redirect('/');

  return (
    <CheckoutForm
      currency={storefront.tenant.currency}
      acceptsDelivery={storefront.settings.accepts_delivery}
      defaultTipBps={storefront.settings.default_tip_bps}
    />
  );
}
