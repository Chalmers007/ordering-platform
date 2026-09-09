import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { loadStorefront, orderingAvailability } from '@/lib/storefront/data';
import { MenuBrowser } from '@/components/storefront/menu-browser';
import { PreviewBanner } from '@/components/storefront/preview-banner';
import { currentPreviewSession, sessionAssets } from '@/lib/preview-personalisation/session';
import { claimCtaHref, walkthroughCtaHref } from '@/lib/storefront/preview';

export const dynamic = 'force-dynamic';

interface PreviewPageProps {
  params: Promise<{ tenantId: string }>;
}

async function getTenant(tenantId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  const client = createClient<Database>(url, key);
  const { data } = await client
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

  const { canOrder } = orderingAvailability(storefront.settings);

  // Get this visitor's session if they have one (for uploaded logo/banner)
  const session = await currentPreviewSession(tenantId);
  const uploads = session ? await sessionAssets(session.id) : [];
  const logo = uploads.find((a) => a.kind === 'logo') ?? null;
  const banner = uploads.find((a) => a.kind === 'banner') ?? null;

  return (
    <>
      {
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
      }
      <MenuBrowser
        categories={storefront.categories}
        currency={storefront.tenant.currency}
        canOrder={false}
        preview={true}
        acceptsDelivery={storefront.settings.accepts_delivery}
        acceptsPickup={storefront.settings.accepts_pickup}
        deliveryMinimumCents={storefront.settings.delivery_minimum_cents}
      />
    </>
  );
}
