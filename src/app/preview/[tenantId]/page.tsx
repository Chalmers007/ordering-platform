import { notFound } from 'next/navigation';
import { loadStorefront } from '@/lib/storefront/data';
import { MenuBrowser } from '@/components/storefront/menu-browser';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { currentPreviewSession, sessionAssets } from '@/lib/preview-personalisation/session';
import { claimCtaHref, walkthroughCtaHref } from '@/lib/storefront/preview';
import { createServiceClient } from '@/lib/supabase/server';
import { PREVIEW_BUCKET } from '@/lib/preview-personalisation/bucket';
import { CartProvider } from '@/lib/cart/cart-context';

export const dynamic = 'force-dynamic';

interface PreviewPageProps {
  params: Promise<{ tenantId: string }>;
}

async function getTenant(tenantId: string) {
  // Use service role to read pending_claim tenants (not readable by anon role)
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenants')
    .select('id, slug, name, status')
    .eq('id', tenantId)
    .single();

  return data ?? null;
}

export default async function PreviewPage({ params }: PreviewPageProps) {
  const { tenantId } = await params;

  // Load tenant info directly from database
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    notFound();
  }

  // Load storefront data for this tenant
  // Set preview=true to mark this as a demo that cannot order
  const storefront = await loadStorefront(tenantId, { preview: true });
  if (!storefront) {
    notFound();
  }

  // Get this visitor's session if they have one (for uploaded logo/banner)
  const session = await currentPreviewSession(tenantId);
  const uploads = session ? await sessionAssets(session.id) : [];
  const logo = uploads.find((a) => a.kind === 'logo') ?? null;
  const banner = uploads.find((a) => a.kind === 'banner') ?? null;

  const bucket = createServiceClient().storage.from(PREVIEW_BUCKET);
  const [logoLink, bannerLink] = await Promise.all([
    logo ? bucket.createSignedUrl(logo.storagePath, 604800) : null,
    banner ? bucket.createSignedUrl(banner.storagePath, 604800) : null,
  ]);

  return (
    <CartProvider tenantId={tenantId} defaultFulfillment={storefront.settings.accepts_delivery ? 'delivery' : 'pickup'}>
      <PreviewBanner
        restaurantName={tenant.name}
        ctaHref={claimCtaHref()}
        walkthroughHref={walkthroughCtaHref()}
        personalise={{
          tenantId,
          logoUrl: logoLink?.data?.signedUrl,
          bannerUrl: bannerLink?.data?.signedUrl,
          hasLogo: Boolean(logo),
          hasBanner: Boolean(banner),
          logoAssetId: logo?.id ?? null,
          bannerAssetId: banner?.id ?? null,
        }}
      />
      <MenuBrowser
        categories={storefront.categories}
        currency={storefront.tenant.currency}
        canOrder={false}
        preview={true}
        acceptsDelivery={storefront.settings.accepts_delivery}
        acceptsPickup={storefront.settings.accepts_pickup}
        deliveryMinimumCents={storefront.settings.delivery_minimum_cents}
      />
    </CartProvider>
  );
}
