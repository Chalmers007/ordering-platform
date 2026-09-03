'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/lib/cart/cart-context';
import { Button } from '@/components/ui/button';
import { CartDrawer } from './cart-drawer';

/**
 * Up to two initials from the trading name.
 *
 * "Cajun Seafood Jacksonville" gives CS, not C. A single letter on a circle
 * reads as a missing asset; two reads as a mark somebody chose. Joining words
 * are skipped, so "The Harbour Grill" is HG rather than TH.
 */
function monogram(name: string): string {
  const words = name
    .split(/[\s&/-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0 && !['the', 'and', 'of', 'at', 'a'].includes(w.toLowerCase()));
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

/**
 * Storefront hero.
 *
 * A full-bleed cover image with the restaurant's logo overlapping its lower
 * edge, and the name and tagline centred beneath — the layout customers
 * recognise from every delivery app.
 *
 * The cart floats over the hero instead of sitting in a bar: the hero is not
 * sticky (a 256px sticky header would eat a phone screen), so the cart needs
 * to stay reachable some other way. It stays fixed to the viewport.
 */
export function StorefrontHeader({
  tenantName,
  logoUrl,
  coverImageUrl,
  tagline,
  currency,
}: {
  tenantName: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  tagline: string | null;
  currency: string;
}) {
  const { itemCount } = useCart();
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <>
      <header>
        <div className="relative h-48 w-full overflow-hidden md:h-64">
            {coverImageUrl ? (
              <>
                <Image src={coverImageUrl} alt="" fill priority sizes="100vw" className="object-cover" unoptimized />
                {/* Keeps the logo legible whatever the restaurant uploads. */}
                <div className="absolute inset-0 bg-black/50" aria-hidden />
              </>
            ) : (
              // No cover image. A stock photograph darkened to 50% read as a
              // blank brown rectangle — worse than nothing, because it looked
              // like something had failed to load. A restaurant with no artwork
              // gets its own name and colours instead, which looks deliberate.
              <div
                className="absolute inset-0 flex items-center justify-center px-6"
                style={{ background: 'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)' }}
              >
                <div
                  className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]"
                  aria-hidden
                />
                <p className="relative max-w-3xl text-center text-2xl font-bold leading-tight tracking-tight text-white drop-shadow-sm md:text-4xl">
                  {tenantName}
                </p>
              </div>
            )}
          </div>

        <div className="flex flex-col items-center px-4 pb-4 text-center">
          <div className="z-10 -mt-10">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt=""
                width={80}
                height={80}
                className="h-20 w-20 rounded-full border-4 border-white bg-white object-cover shadow-lg"
                unoptimized
              />
            ) : (
              <div
                  className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white text-xl font-bold tracking-tight text-white shadow-lg"
                  style={{ background: 'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)' }}
                  aria-hidden
                >
                  {monogram(tenantName)}
                </div>
            )}
          </div>

          <h1 className="mt-3 text-2xl font-bold text-neutral-900">{tenantName}</h1>
          {tagline ? <p className="mt-1 text-sm text-neutral-600">{tagline}</p> : null}
        </div>
      </header>

      {/* Fixed rather than absolute: it has to survive scrolling past the
          hero, and it is the only way back to the cart from anywhere. */}
      <Button
        variant="primary"
        size="md"
        onClick={() => setCartOpen(true)}
        aria-label={`Open cart, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
        className="fixed right-4 top-4 z-40 shadow-lg ring-1 ring-black/10"
      >
        <ShoppingBag className="h-4 w-4" aria-hidden />
        <span className="tabular-nums">{itemCount}</span>
      </Button>

      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} currency={currency} />
    </>
  );
}
