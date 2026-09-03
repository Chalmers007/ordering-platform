import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Toaster } from 'sonner';
import { getTenantContext } from '@/lib/tenancy/context';
import { isPreviewRequest } from '@/lib/storefront/preview';
import { loadStorefront } from '@/lib/storefront/data';
import { brandStyleSheet } from '@/lib/storefront/brand';
import { CartProvider } from '@/lib/cart/cart-context';
import { StorefrontHeader } from '@/components/storefront/storefront-header';
import { KitchenStatusBanner } from '@/components/storefront/kitchen-status-banner';

export const dynamic = 'force-dynamic';

/**
 * Every storefront page renders inside the tenant resolved by middleware.
 * Brand colours are published as CSS custom properties here, so the white
 * labelling is one source of truth rather than a prop threaded through every
 * component.
 */
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenantContext();
  if (!tenant) notFound();

  // The layout loads the storefront too, and must respect the preview flag for
  // the same reason the page does — otherwise RLS hides an unclaimed tenant
  // here, this notFound() wins over the page's content, and the visitor gets
  // "Page not found" while the preview sits fully rendered in the payload.
  const preview = await isPreviewRequest();
  const storefront = await loadStorefront(tenant.tenantId, { preview });
  if (!storefront) notFound();

  const { settings } = storefront;

  return (
    <div
      className="min-h-dvh text-neutral-900"
      style={{
        background: 'var(--brand-background)',
        fontFamily: 'var(--brand-font)',
      }}
    >
      {/*
        On :root rather than on this element. Radix portals dialogs to
        <body>, so variables scoped here would not reach the modifier modal
        or the cart — their primary buttons would render with no background.
        The value is validated as a hex colour before interpolation, since
        it is tenant-supplied.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: brandStyleSheet({
            primary: settings.brand_primary_color,
            accent: settings.brand_accent_color,
            background: settings.background_color,
            font: settings.font_family,
          }),
        }}
      />
      <CartProvider
        tenantId={tenant.tenantId}
        defaultFulfillment={settings.accepts_delivery ? 'delivery' : 'pickup'}
      >
        <StorefrontHeader
          tenantName={storefront.tenant.name}
          logoUrl={settings.logo_url}
          coverImageUrl={settings.cover_image_url}
          tagline={settings.tagline}
          currency={storefront.tenant.currency}
        />
        <KitchenStatusBanner
          tenantId={tenant.tenantId}
          initialPaused={settings.is_kitchen_paused}
          initialReason={settings.kitchen_paused_reason}
          initialPrepMins={settings.estimated_prep_time_mins}
        />
        <main className="mx-auto w-full max-w-6xl px-4 pb-32">{children}</main>
      </CartProvider>
      <Toaster position="top-center" richColors />
    </div>
  );
}
