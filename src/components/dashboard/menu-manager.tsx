'use client';

import { useMemo, useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatCents } from '@/lib/money';
import { MenuImport } from './menu-import';
import {
  createCategory,
  deleteCategory,
  deleteItem,
  renameCategory,
  saveItem,
  setItemAvailability,
} from '@/app/(kds)/app/(dashboard)/menu/actions';
import type { MenuCategory, MenuItem, MenuModifierGroup } from '@/types/database';

const inputClass =
  'border-neutral-700 bg-neutral-950 text-neutral-100 placeholder:text-neutral-600';

type Draft = {
  id?: string;
  categoryId: string | null;
  name: string;
  description: string;
  price: string;
  isAvailable: boolean;
  isTaxable: boolean;
  modifierGroupIds: string[];
};

function emptyDraft(categoryId: string | null): Draft {
  return {
    categoryId,
    name: '',
    description: '',
    price: '',
    isAvailable: true,
    isTaxable: true,
    modifierGroupIds: [],
  };
}

export function MenuManager({
  categories,
  items,
  groups,
  links,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  groups: MenuModifierGroup[];
  links: { item_id: string; group_id: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const groupsByItem = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links) {
      map.set(link.item_id, [...(map.get(link.item_id) ?? []), link.group_id]);
    }
    return map;
  }, [links]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const key = item.category_id ?? 'uncategorised';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  function run<T>(action: Promise<{ ok: boolean; error?: string } & T>, success: string) {
    startTransition(async () => {
      const result = await action;
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? 'Something went wrong');
    });
  }

  function openEdit(item: MenuItem) {
    setDraft({
      id: item.id,
      categoryId: item.category_id,
      name: item.name,
      description: item.description ?? '',
      price: (item.price_cents / 100).toFixed(2),
      isAvailable: item.is_available,
      isTaxable: item.is_taxable,
      modifierGroupIds: groupsByItem.get(item.id) ?? [],
    });
  }

  function submitDraft() {
    if (!draft) return;
    startTransition(async () => {
      const result = await saveItem({
        id: draft.id,
        categoryId: draft.categoryId,
        name: draft.name,
        description: draft.description,
        // Dollars in the form, cents in the database — converted once, here.
        priceCents: Math.round(Number(draft.price || '0') * 100),
        isAvailable: draft.isAvailable,
        isTaxable: draft.isTaxable,
        modifierGroupIds: draft.modifierGroupIds,
      });

      if (result.ok) {
        toast.success(draft.id ? 'Item updated' : 'Item added');
        setDraft(null);
      } else toast.error(result.error);
    });
  }

  const uncategorised = itemsByCategory.get('uncategorised') ?? [];

  return (
    <div className="space-y-4 pb-16">
      {/* Add a category */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="font-semibold text-neutral-100">Categories</h2>
        <div className="mt-3 flex gap-2">
          <Input
            className={inputClass}
            value={newCategory}
            placeholder="New category, e.g. Desserts"
            onChange={(event) => setNewCategory(event.target.value)}
          />
          <Button
            loading={pending}
            disabled={!newCategory.trim()}
            onClick={() => {
              run(createCategory(newCategory), 'Category added');
              setNewCategory('');
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        </div>
      </section>

      {categories.length === 0 && items.length === 0 ? (
        <p className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-10 text-center text-sm text-neutral-400">
          No menu yet. Add a category above, or import a CSV below.
        </p>
      ) : null}

      {categories.map((category) => {
        const categoryItems = itemsByCategory.get(category.id) ?? [];

        return (
          <section key={category.id} className="rounded-xl border border-neutral-800 bg-neutral-900">
            <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
              <Input
                className={`${inputClass} max-w-xs`}
                defaultValue={category.name}
                aria-label={`Rename ${category.name}`}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next && next !== category.name) {
                    run(renameCategory(category.id, next), 'Category renamed');
                  }
                }}
              />
              <span className="text-xs text-neutral-500">
                {categoryItems.length} item{categoryItems.length === 1 ? '' : 's'}
              </span>

              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(emptyDraft(category.id))}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Item
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${category.name}`}
                  className="text-neutral-400 hover:bg-red-900/40 hover:text-red-300"
                  onClick={() => run(deleteCategory(category.id), 'Category deleted')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <ul className="divide-y divide-neutral-800">
              {categoryItems.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-neutral-500">
                  Nothing in this category yet.
                </li>
              ) : (
                categoryItems.map((item) => {
                  const attached = groupsByItem.get(item.id) ?? [];
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-neutral-100">{item.name}</p>
                        {item.description ? (
                          <p className="truncate text-sm text-neutral-400">{item.description}</p>
                        ) : null}
                        {attached.length > 0 ? (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {attached.length} option group{attached.length === 1 ? '' : 's'}
                          </p>
                        ) : null}
                      </div>

                      <span className="tabular-nums text-neutral-200">
                        {formatCents(item.price_cents)}
                      </span>

                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={item.is_available}
                          onChange={(event) =>
                            run(
                              setItemAvailability(item.id, event.target.checked),
                              event.target.checked ? 'Item available' : 'Item marked sold out',
                            )
                          }
                        />
                        Available
                      </label>

                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${item.name}`}
                        className="text-neutral-300 hover:bg-neutral-800"
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${item.name}`}
                        className="text-neutral-400 hover:bg-red-900/40 hover:text-red-300"
                        onClick={() => run(deleteItem(item.id), 'Item deleted')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        );
      })}

      {uncategorised.length > 0 ? (
        <section className="rounded-xl border border-amber-700/40 bg-neutral-900 p-4">
          <h2 className="font-semibold text-amber-200">Uncategorised</h2>
          <p className="mt-0.5 text-sm text-neutral-400">
            These do not appear on the storefront until they are in a category.
          </p>
          <ul className="mt-2 space-y-1">
            {uncategorised.map((item) => (
              <li key={item.id} className="flex items-center gap-3 text-sm text-neutral-200">
                <span className="flex-1">{item.name}</span>
                <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                  Assign
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <MenuImport />

      {/* Item editor */}
      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="sm:max-w-lg">
          {draft ? (
            <div className="overflow-y-auto px-5 pb-5 pt-6">
              <DialogTitle className="pr-8 text-lg font-semibold">
                {draft.id ? 'Edit item' : 'New item'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-neutral-600">
                Prices are what the customer sees before options and tax.
              </DialogDescription>

              <div className="mt-4 space-y-3">
                <Input
                  aria-label="Item name"
                  placeholder="Name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
                <Textarea
                  aria-label="Description"
                  placeholder="Description"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    Price ($)
                    <Input
                      className="mt-1"
                      inputMode="decimal"
                      value={draft.price}
                      onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    Category
                    <select
                      className="mt-1 h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm"
                      value={draft.categoryId ?? ''}
                      onChange={(event) =>
                        setDraft({ ...draft, categoryId: event.target.value || null })
                      }
                    >
                      <option value="">Uncategorised</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={draft.isAvailable}
                      onChange={(event) => setDraft({ ...draft, isAvailable: event.target.checked })}
                    />
                    Available
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={draft.isTaxable}
                      onChange={(event) => setDraft({ ...draft, isTaxable: event.target.checked })}
                    />
                    Taxable
                  </label>
                </div>

                {groups.length > 0 ? (
                  <fieldset>
                    <legend className="text-sm font-medium">Option groups</legend>
                    <p className="mb-2 text-xs text-neutral-500">
                      Attaching a required group means this item opens the customisation modal
                      instead of adding straight to the cart.
                    </p>
                    <div className="space-y-1">
                      {groups.map((group) => (
                        <label
                          key={group.id}
                          className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={draft.modifierGroupIds.includes(group.id)}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                modifierGroupIds: event.target.checked
                                  ? [...draft.modifierGroupIds, group.id]
                                  : draft.modifierGroupIds.filter((id) => id !== group.id),
                              })
                            }
                          />
                          <span className="flex-1">{group.name}</span>
                          <span className="text-xs text-neutral-500">
                            {group.is_required ? 'required' : 'optional'} ·{' '}
                            {group.selection_type === 'single' ? 'one' : 'many'}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>

              <div className="mt-5 flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  loading={pending}
                  disabled={!draft.name.trim()}
                  onClick={submitDraft}
                >
                  {draft.id ? 'Save changes' : 'Add item'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
