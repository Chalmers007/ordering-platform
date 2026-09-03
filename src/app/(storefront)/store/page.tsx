import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenancy/context';
import { loadStorefront, orderingAvailability } from '@/lib/storefront/data';
import { MenuBrowser } from '@/components/storefront/menu-browser';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { isPreviewRequest, claimCtaHref, walkthroughCtaHref } from '@/lib/storefront/preview';
import { currentPreviewSession, sessionAssets } from '@/lib/preview-personalisation/session';

export const dynamic = 'force-dynamic';

export default async function StorefrontPage() {
  const tenant = await getTenantContext();
  if (!tenant) notFound();

  const preview = await isPreviewRequest();
  const storefront = await loadStorefront(tenant.tenantId, { preview });
  if (!storefront) notFound();

  const { canOrder } = orderingAvailability(storefront.settings);

  // Only this browser's own uploads. A visitor with no session sees the
  // storefront exactly as it was staged.
  const session = preview ? await currentPreviewSession(tenant.tenantId) : null;
  const uploads = session ? await sessionAssets(session.id) : [];
  const logo = uploads.find((a) => a.kind === 'logo') ?? null;
  const banner = uploads.find((a) => a.kind === 'banner') ?? null;
  // An unclaimed storefront is a demonstration. `canOrder` is forced off here
  // rather than merely hidden in the UI, and the database refuses independently
  // — price_cart() rejects a non-active tenant AND every scraped item is
  // unavailable until the owner confirms the menu. Three refusals, none of them
  // relying on the others.
  return (
    <>
      {preview && (
        <PreviewBanner
          ctaHref={claimCtaHref()}
          walkthroughHref={walkthroughCtaHref()}
          personalise={{
            hasLogo: Boolean(logo),
            hasBanner: Boolean(banner),
            logoAssetId: logo?.id ?? null,
            bannerAssetId: banner?.id ?? null,
          }}
        />
      )}
    <MenuBrowser
      categories={storefront.categories}
      currency={storefront.tenant.currency}
      canOrder={canOrder && !preview}
      preview={preview}
      acceptsDelivery={storefront.settings.accepts_delivery}
      acceptsPickup={storefront.settings.accepts_pickup}
      deliveryMinimumCents={storefront.settings.delivery_minimum_cents}
    />
    </>
  );
}
