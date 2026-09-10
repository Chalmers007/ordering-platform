'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PersonalisePanel } from './personalise-panel';

/**
 * The banner on a storefront that has been built but not yet claimed.
 *
 * This page was assembled from the restaurant's own published menu, and the
 * person most likely to be reading it is the restaurant. So it has to say two
 * things plainly and immediately: this is a demonstration, and it is not
 * taking orders. Anything vaguer risks a diner believing they have ordered
 * dinner, or an owner believing prices they never approved are already live.
 *
 * No tenant id or credential is displayed. The preview tenant ID is passed
 * to the upload control for server-side validation. The claim link is a
 * bearer credential and is never rendered on a public page — the call to
 * action leads to the sales route, which is where a real claim link is issued
 * from after the business is spoken to.
 *
 * Colours are chosen for the LIGHT storefront surface (brand-background
 * defaults to #FFFFFF). The first version used a dark-surface amber palette
 * and rendered amber-on-amber: the most important sentence on the page was
 * the one nobody could read.
 */
export function PreviewBanner({
  restaurantName,
  ctaHref,
  walkthroughHref,
  personalise,
}: {
  restaurantName: string;
  ctaHref: string;
  walkthroughHref: string;
  /** Absent when the visitor has uploaded nothing yet. */
  personalise: { tenantId?: string; logoUrl?: string; bannerUrl?: string; hasLogo: boolean; hasBanner: boolean; logoAssetId: string | null; bannerAssetId: string | null };
}) {
  const [images, setImages] = useState<{ logo?: string | null; banner?: string | null }>({});
  const logoUrl = images.logo === undefined ? personalise.logoUrl : images.logo;
  const bannerUrl = images.banner === undefined ? personalise.bannerUrl : images.banner;
  return (
    <div className="border-b border-amber-300 bg-amber-50">
      {personalise.tenantId && bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bannerUrl} alt="Storefront banner" className="h-24 w-full object-cover sm:h-auto sm:max-h-64" />
      ) : null}
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 pt-3 sm:gap-3 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {personalise.tenantId && logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`${restaurantName} logo`} className="h-12 w-12 shrink-0 rounded-md bg-white object-contain sm:h-20 sm:w-20" />
            ) : null}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-900 sm:text-sm">Preview — not yet live</p>
              <h1 className="line-clamp-2 text-lg font-bold leading-tight text-neutral-900 sm:mt-2 sm:text-2xl">{restaurantName}</h1>
            </div>
          </div>
          <p className="mt-1 text-xs text-neutral-600 sm:hidden">Preview only · No orders or payments.</p>
          <p className="mt-1 hidden text-sm text-neutral-800 sm:block">
            This storefront was prepared for your restaurant. Explore the menu and see how online
            ordering could look.
          </p>
          <p className="mt-1 hidden text-xs text-neutral-600 sm:block">
            The menu below was read from your website. Nothing here can take an order or a payment yet,
            and prices are not live until you confirm them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:shrink-0">
          <Link
            href={ctaHref}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-center text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            Activate My Storefront
          </Link>
          <Link
            href={walkthroughHref}
            className="inline-flex min-h-11 items-center text-xs font-semibold text-amber-800 underline underline-offset-4 hover:text-amber-950 sm:text-sm"
          >
            Book a Walkthrough
          </Link>
        </div>
      </div>
      <div className="mx-auto flex max-w-5xl justify-end px-4 pb-1 sm:pb-2">
        <PersonalisePanel {...personalise} onImageChange={(kind, url) => setImages((current) => ({ ...current, [kind]: url }))} />
      </div>
    </div>
  );
}
