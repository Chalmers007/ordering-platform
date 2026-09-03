'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { formatCents } from '@/lib/money';
import { menuImageUrl } from '@/lib/storefront/menu-image';
import { useCart } from '@/lib/cart/cart-context';
import { ModifierModal } from './modifier-modal';
import type {
  MenuCategoryWithItems,
  MenuItemWithModifiers,
} from '@/types/database';

const ALL = 'all';

export function MenuBrowser({
  categories,
  currency,
  canOrder,
  preview = false,
  acceptsDelivery,
  acceptsPickup,
  deliveryMinimumCents,
}: {
  categories: MenuCategoryWithItems[];
  currency: string;
  canOrder: boolean;
  /**
   * A storefront that has been built but not claimed.
   *
   * Every item is deliberately unavailable in the database until the owner
   * confirms the menu — but that is a fact about our staging process, not about
   * the restaurant's kitchen. Showing "Sold out" across a demo tells a prospect
   * their business is closed. In preview the cards look like a working menu and
   * the buttons explain themselves when pressed.
   */
  preview?: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryMinimumCents: number;
}) {
  const { addLine, cart, setFulfillment } = useCart();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [activeItem, setActiveItem] = useState<MenuItemWithModifiers | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return categories
      .filter((category) => activeCategory === ALL || category.id === activeCategory)
      .map((category) => ({
        ...category,
        menu_items: needle
          ? category.menu_items.filter((item) =>
              [item.name, item.description ?? '', ...(item.dietary_tags ?? [])]
                .join(' ')
                .toLowerCase()
                .includes(needle),
            )
          : category.menu_items,
      }))
      .filter((category) => category.menu_items.length > 0);
  }, [categories, query, activeCategory]);

  function openItem(item: MenuItemWithModifiers) {
    // In preview mode, open the modal to show customization, but the Add button
    // will show a demo message instead of actually adding to cart.
    if (!preview && !canOrder) {
      toast.error('This restaurant is not accepting orders right now.');
      return;
    }
    if (!preview && !item.is_available) return;

    // Nothing to choose: straight into the cart (unless preview). Anything with options —
    // including a required size — has to go through the modal, because the
    // server will refuse to price a pizza with no size.
    const hasGroups = item.menu_item_modifier_groups.some(
      (link) => link.menu_modifier_groups.is_active,
    );
    if (!hasGroups && !preview) {
      addLine({ menuItemId: item.id, quantity: 1, modifiers: [] });
      toast.success(`${item.name} added`);
      return;
    }

    setActiveItem(item);
    setModalOpen(true);
  }

  return (
    <div className="pt-2">
      {/* Fulfilment */}
      {acceptsDelivery && acceptsPickup ? (
        <div
          role="radiogroup"
          aria-label="Order type"
          className="mb-4 inline-flex rounded-full border border-neutral-300 bg-white p-1"
        >
          {(['delivery', 'pickup'] as const).map((mode) => (
            <button
              key={mode}
              role="radio"
              aria-checked={cart.fulfillmentType === mode}
              onClick={() => setFulfillment(mode)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition ${
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
          className="rounded-full pl-9 pr-9"
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

      {/* Category filter pills. Names come from the tenant's own menu and are
          upper-cased in CSS, never hardcoded. */}
      <nav
        aria-label="Menu categories"
        className="sticky top-0 z-20 -mx-4 mb-4 overflow-x-auto bg-neutral-50/95 px-4 py-2 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex gap-2">
          {[{ id: ALL, name: 'All' }, ...categories].map((category) => {
            const active = activeCategory === category.id;
            return (
              <li key={category.id}>
                <button
                  onClick={() => setActiveCategory(category.id)}
                  aria-pressed={active}
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium uppercase tracking-wide transition ${
                    active
                      ? 'bg-[var(--brand-primary)] text-white'
                      : 'border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  {category.name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-neutral-500">
          {query.trim()
            ? `Nothing on the menu matches “${query.trim()}”.`
            : 'Nothing on the menu right now.'}
        </p>
      ) : null}

      {visible.map((category) => (
        <section key={category.id} className="pb-6" aria-labelledby={`cat-${category.id}`}>
          <h2 id={`cat-${category.id}`} className="text-lg font-semibold">
            {category.name}
          </h2>
          {category.description ? (
            <p className="mt-0.5 text-sm text-neutral-600">{category.description}</p>
          ) : null}

          <ul className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {category.menu_items.map((item) => {
              const image = menuImageUrl(item.image_path);
              // In preview, unavailability is our staging flag rather than the
              // kitchen's word, so it is not surfaced and the card stays live.
              const soldOut = !preview && !item.is_available;
              const disabled = !preview && (soldOut || !canOrder);

              return (
                <li
                  key={item.id}
                  className={`relative flex gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm transition ${
                    disabled ? 'opacity-60' : 'hover:shadow-md'
                  }`}
                >
                  {image ? (
                    <Image
                      src={image}
                      alt=""
                      width={96}
                      height={96}
                      className="h-24 w-24 flex-shrink-0 rounded-lg object-cover"
                      unoptimized
                    />
                  ) : (
                    // Most scraped menus carry no item photography, and a flat
                    // grey square on every card reads as a page that failed to
                    // load. A tinted tile in the restaurant's own colours reads
                    // as a design choice instead.
                    <div
                      className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background:
                          'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 14%, white) 0%, color-mix(in srgb, var(--brand-accent) 18%, white) 100%)',
                      }}
                      aria-hidden
                    >
                      <span
                        className="text-lg font-semibold opacity-45"
                        style={{ color: 'var(--brand-primary)' }}
                      >
                        {item.name.replace(/^[\w.]+\.?\s*/, '').slice(0, 1).toUpperCase() ||
                          item.name.slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  )}

                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="font-semibold leading-snug">
                      {/*
                        Stretched link: the pseudo-element covers the whole
                        card so the entire tile is tappable, while the Add
                        button below sits above it on z-10. Wrapping the card
                        in a <button> instead would nest one button inside
                        another, which is invalid and breaks keyboard users.
                      */}
                      <button
                        onClick={() => openItem(item)}
                        disabled={disabled}
                        className="text-left after:absolute after:inset-0 after:content-[''] disabled:cursor-not-allowed"
                      >
                        {item.name}
                      </button>
                    </h3>

                    {soldOut ? (
                      <span className="mt-1 w-fit rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                        Sold out
                      </span>
                    ) : item.description ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">
                        {item.description}
                      </p>
                    ) : null}

                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <span className="font-bold tabular-nums">
                        {formatCents(item.price_cents, currency)}
                      </span>
                      <button
                        onClick={() => openItem(item)}
                        disabled={disabled}
                        aria-label={`Add ${item.name}`}
                        className="relative z-10 rounded-lg bg-[var(--brand-primary)] px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:opacity-100"
                      >
                        + Add
                      </button>
                    </div>
                  </div>
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
        preview={preview}
        onAdd={(input) => {
          if (preview) {
            toast('This is a preview. Ordering will be available after you activate your storefront.');
            return;
          }
          addLine(input);
          toast.success('Added to your order');
        }}
      />
    </div>
  );
}
