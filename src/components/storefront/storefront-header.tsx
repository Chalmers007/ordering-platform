'use client';

import Image from 'next/image';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/lib/cart/cart-context';
import { Button } from '@/components/ui/button';
import { CartDrawer } from './cart-drawer';
import { useState } from 'react';

export function StorefrontHeader({
  tenantName,
  logoUrl,
  tagline,
  currency,
}: {
  tenantName: string;
  logoUrl: string | null;
  tagline: string | null;
  currency: string;
}) {
  const { itemCount } = useCart();
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-lg object-cover"
              unoptimized
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold text-white"
              style={{ background: 'var(--brand-primary)' }}
              aria-hidden
            >
              {tenantName.slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight">{tenantName}</h1>
            {tagline ? (
              <p className="truncate text-xs text-neutral-500">{tagline}</p>
            ) : null}
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={() => setCartOpen(true)}
            aria-label={`Open cart, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
          >
            <ShoppingBag className="h-4 w-4" aria-hidden />
            <span className="tabular-nums">{itemCount}</span>
          </Button>
        </div>
      </header>

      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} currency={currency} />
    </>
  );
}
