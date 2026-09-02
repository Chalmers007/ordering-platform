import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { loadStorefront, orderingAvailability } from '@/lib/storefront/data';
import { MenuBrowser } from '@/components/storefront/menu-browser';

export const dynamic = 'force-dynamic';

export default async function StorefrontPage() {
  const tenant = await getTenantContext();
  if (!tenant) notFound();

  const storefront = await loadStorefront(tenant.tenantId);
  if (!storefront) notFound();

  const { canOrder } = orderingAvailability(storefront.settings);

  return (
    <MenuBrowser
      categories={storefront.categories}
      currency={storefront.tenant.currency}
      canOrder={canOrder}
      acceptsDelivery={storefront.settings.accepts_delivery}
      acceptsPickup={storefront.settings.accepts_pickup}
      deliveryMinimumCents={storefront.settings.delivery_minimum_cents}
    />
  );
}
