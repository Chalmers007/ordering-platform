import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { loadStorefront, orderingAvailability } from '@/lib/storefront/data';
import { MenuBrowser } from '@/components/storefront/menu-browser';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { isPreviewRequest, claimCtaHref } from '@/lib/storefront/preview';

export const dynamic = 'force-dynamic';

export default async function StorefrontPage() {
  const tenant = await getTenantContext();
  if (!tenant) notFound();

  const preview = await isPreviewRequest();
  const storefront = await loadStorefront(tenant.tenantId, { preview });
  if (!storefront) notFound();

  const { canOrder } = orderingAvailability(storefront.settings);
  // An unclaimed storefront is a demonstration. `canOrder` is forced off here
  // rather than merely hidden in the UI, and the database refuses independently
  // — price_cart() rejects a non-active tenant AND every scraped item is
  // unavailable until the owner confirms the menu. Three refusals, none of them
  // relying on the others.
  return (
    <>
      {preview && <PreviewBanner ctaHref={claimCtaHref()} />}
    <MenuBrowser
      categories={storefront.categories}
      currency={storefront.tenant.currency}
      canOrder={canOrder && !preview}
      acceptsDelivery={storefront.settings.accepts_delivery}
      acceptsPickup={storefront.settings.accepts_pickup}
      deliveryMinimumCents={storefront.settings.delivery_minimum_cents}
    />
    </>
  );
}
