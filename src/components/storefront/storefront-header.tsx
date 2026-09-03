'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/lib/cart/cart-context';
import { Button } from '@/components/ui/button';
import { CartDrawer } from './cart-drawer';

/** Shipped with the app rather than hot-linked, so a storefront never
 *  depends on someone else's image host staying up. */
const FALLBACK_COVER = '/storefront-cover-fallback.png';

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
          <Image
            src={coverImageUrl || FALLBACK_COVER}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
            unoptimized
          />
          {/* Keeps the logo and anything overlaid legible whatever the
              restaurant uploads — a bright photo would otherwise wash it out. */}
          <div className="absolute inset-0 bg-black/50" aria-hidden />
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
                className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white text-2xl font-bold shadow-lg"
                style={{ color: 'var(--brand-primary)' }}
                aria-hidden
              >
                {tenantName.slice(0, 1).toUpperCase()}
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
