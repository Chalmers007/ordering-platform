'use client';

import { ArrowLeft, Search } from 'lucide-react';
import { useState } from 'react';
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
function monogram(name: string): string {
  const words = name
    .split(/[\s&/-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0 && !['the', 'and', 'of', 'at', 'a'].includes(word.toLowerCase()));
  return words.length === 0 ? '?' : (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

export function PreviewBanner({
  restaurantName,
  tagline,
  ctaHref,
  walkthroughHref,
  personalise,
}: {
  restaurantName: string;
  tagline?: string | null;
  ctaHref: string;
  walkthroughHref: string;
  /** Absent when the visitor has uploaded nothing yet. */
  personalise: { tenantId?: string; logoUrl?: string; bannerUrl?: string; hasLogo: boolean; hasBanner: boolean; logoAssetId: string | null; bannerAssetId: string | null };
}) {
  const [images, setImages] = useState<{ logo?: string | null; banner?: string | null }>({});
  const logoUrl = images.logo === undefined ? personalise.logoUrl : images.logo;
  const bannerUrl = images.banner === undefined ? personalise.bannerUrl : images.banner;
  const personalised = { ...personalise, logoUrl: logoUrl ?? undefined, bannerUrl: bannerUrl ?? undefined };

  return (
    <header className="bg-neutral-950 text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/95 backdrop-blur" aria-label="Preview navigation">
        <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-4">
          <a href="/dashboard" aria-label="Back to dashboard" className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </a>
          <a href="#menu" aria-label="Search menu" className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
            <Search className="h-5 w-5" aria-hidden />
          </a>
          <div className="flex min-w-0 items-center gap-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md bg-white object-contain" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15 text-xs font-bold text-white" aria-hidden>
                {monogram(restaurantName)}
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">{restaurantName}</p>
              <p className="truncate text-[11px] text-white/55">Preview storefront · not yet live</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <a href={walkthroughHref} className="hidden rounded-lg px-2.5 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 hover:text-white sm:inline-flex">Book Walkthrough</a>
            <a href={ctaHref} className="inline-flex rounded-lg bg-white px-2.5 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-white/90">
              <span className="sm:hidden">Activate</span>
              <span className="hidden sm:inline">Activate My Storefront</span>
            </a>
            <PersonalisePanel {...personalised} onImageChange={(kind, url) => setImages((current) => ({ ...current, [kind]: url }))} triggerLabel="Customize" triggerClassName="rounded-lg border border-white/20 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10" />
          </div>
        </div>
      </nav>
      <section className="relative isolate h-[min(68vw,30rem)] min-h-[18rem] overflow-visible sm:min-h-[22rem]" aria-labelledby="preview-store-name">
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#171717_0%,#3f2d1d_55%,#111827_100%)]" aria-hidden />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.72)_0%,rgba(0,0,0,.3)_42%,rgba(0,0,0,.82)_100%)]" aria-hidden />
        <div className="relative flex h-full flex-col items-center justify-center px-4 pb-2 text-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${restaurantName} logo`} className="h-24 w-24 rounded-full border-4 border-white/90 bg-white object-contain shadow-2xl sm:h-28 sm:w-28" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/80 bg-white/15 text-2xl font-bold text-white shadow-2xl sm:h-28 sm:w-28" aria-hidden>{monogram(restaurantName)}</div>
          )}
          <h1 id="preview-store-name" className="mt-4 text-2xl font-bold tracking-tight text-white drop-shadow sm:text-4xl">{restaurantName}</h1>
          <p className="mt-1 max-w-xl text-sm text-white/80 sm:text-base">{tagline || 'Preview storefront · Fat Man Approved'}</p>
        </div>
      </section>
    </header>
  );
}
