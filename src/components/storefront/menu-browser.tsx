'use client';

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money';
import { menuImageUrl } from '@/lib/storefront/menu-image';
import { useCart } from '@/lib/cart/cart-context';
import { ModifierModal } from './modifier-modal';
import type {
  MenuCategoryWithItems,
  MenuItemWithModifiers,
} from '@/types/database';

export function MenuBrowser({
  categories,
  currency,
  canOrder,
  acceptsDelivery,
  acceptsPickup,
  deliveryMinimumCents,
}: {
  categories: MenuCategoryWithItems[];
  currency: string;
  canOrder: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryMinimumCents: number;
}) {
  const { addLine, cart, setFulfillment } = useCart();
  const [query, setQuery] = useState('');
  const [activeItem, setActiveItem] = useState<MenuItemWithModifiers | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return categories;

    return categories
      .map((category) => ({
        ...category,
        menu_items: category.menu_items.filter((item) =>
          [item.name, item.description ?? '', ...(item.dietary_tags ?? [])]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((category) => category.menu_items.length > 0);
  }, [categories, query]);

  function openItem(item: MenuItemWithModifiers) {
    if (!canOrder) {
      toast.error('This restaurant is not accepting orders right now.');
      return;
    }
    if (!item.is_available) return;

    // No options to choose: straight into the cart.
    const hasGroups = item.menu_item_modifier_groups.some(
      (link) => link.menu_modifier_groups.is_active,
    );
    if (!hasGroups) {
      addLine({ menuItemId: item.id, quantity: 1, modifiers: [] });
      toast.success(`${item.name} added`);
      return;
    }

    setActiveItem(item);
    setModalOpen(true);
  }

  return (
    <div className="pt-4">
      {/* Fulfilment switch */}
      {acceptsDelivery && acceptsPickup ? (
        <div
          role="radiogroup"
          aria-label="Order type"
          className="mb-4 inline-flex rounded-lg border border-neutral-300 bg-white p-1"
        >
          {(['delivery', 'pickup'] as const).map((mode) => (
            <button
              key={mode}
              role="radio"
              aria-checked={cart.fulfillmentType === mode}
              onClick={() => setFulfillment(mode)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                cart.fulfillmentType === mode
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      ) : null}

      {cart.fulfillmentType === 'delivery' && deliveryMinimumCents > 0 ? (
        <p className="mb-4 text-sm text-neutral-600">
          Delivery minimum {formatCents(deliveryMinimumCents, currency)}
        </p>
      ) : null}

      {/* Search */}
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the menu"
          aria-label="Search the menu"
          className="pl-9 pr-9"
        />
        {query ? (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Category rail — horizontally scrollable on phones */}
      {filtered.length > 1 ? (
        <nav
          aria-label="Menu categories"
          className="sticky top-[57px] z-20 -mx-4 mb-2 overflow-x-auto border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex gap-2">
            {filtered.map((category) => (
              <li key={category.id}>
                <button
                  onClick={() =>
                    sectionRefs.current[category.id]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                  className="whitespace-nowrap rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-400"
                >
                  {category.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-neutral-500">
          {query.trim()
            ? `Nothing on the menu matches “${query.trim()}”.`
            : 'This menu is not available right now.'}
        </p>
      ) : null}

      {filtered.map((category) => (
        <section
          key={category.id}
          ref={(node) => {
            sectionRefs.current[category.id] = node;
          }}
          className="scroll-mt-32 py-4"
          aria-labelledby={`cat-${category.id}`}
        >
          <h2 id={`cat-${category.id}`} className="text-lg font-semibold">
            {category.name}
          </h2>
          {category.description ? (
            <p className="mt-0.5 text-sm text-neutral-600">{category.description}</p>
          ) : null}

          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {category.menu_items.map((item) => {
              const image = menuImageUrl(item.image_path);
              const soldOut = !item.is_available;

              return (
                <li key={item.id}>
                  <button
                    onClick={() => openItem(item)}
                    disabled={soldOut || !canOrder}
                    aria-label={`${item.name}, ${formatCents(item.price_cents, currency)}${soldOut ? ', sold out' : ''}`}
                    className={`flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left transition-colors ${
                      soldOut || !canOrder
                        ? 'cursor-not-allowed opacity-55'
                        : 'hover:border-neutral-300 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="truncate font-medium">{item.name}</h3>
                        {soldOut ? (
                          <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                            Sold out
                          </span>
                        ) : null}
                      </div>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600">
                          {item.description}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-sm font-semibold tabular-nums">
                        {formatCents(item.price_cents, currency)}
                      </p>
                      {item.dietary_tags?.length ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1">
                          {item.dietary_tags.map((tag) => (
                            <li
                              key={tag}
                              className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600"
                            >
                              {tag}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        width={88}
                        height={88}
                        className="h-22 w-22 shrink-0 rounded-lg object-cover"
                        style={{ height: 88, width: 88 }}
                        unoptimized
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <ModifierModal
        item={activeItem}
        currency={currency}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onAdd={(input) => {
          addLine(input);
          toast.success('Added to your order');
        }}
      />

      {!canOrder ? (
        <Button className="sr-only" disabled>
          Ordering is paused
        </Button>
      ) : null}
    </div>
  );
}
