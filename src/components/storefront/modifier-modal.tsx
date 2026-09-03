'use client';

import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { formatCents } from '@/lib/money';
import {
  previewLineCents,
  validateModifierSelections,
} from '@/lib/cart/modifier-rules';
import type { CartModifierSelection, MenuItemWithModifiers } from '@/types/database';

/**
 * Modifier picker.
 *
 * Required groups are radio-like (one choice, cannot be cleared once made);
 * optional groups are checkboxes capped at `max_selections`. The same rules
 * are re-checked by `price_cart()` in SQL — this is the courtesy, not the
 * enforcement.
 */
export function ModifierModal({
  item,
  currency,
  open,
  onOpenChange,
  onAdd,
}: {
  item: MenuItemWithModifiers | null;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: {
    menuItemId: string;
    quantity: number;
    modifiers: CartModifierSelection[];
    notes?: string;
  }) => void;
}) {
  const [selections, setSelections] = useState<CartModifierSelection[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Reset whenever a different item opens the modal.
  const [lastItemId, setLastItemId] = useState<string | null>(null);
  if (item && item.id !== lastItemId) {
    setLastItemId(item.id);
    setSelections(
      item.menu_item_modifier_groups.flatMap((link) =>
        link.menu_modifier_groups.menu_modifiers
          .filter((m) => m.is_default && m.is_available)
          .map((m) => ({ modifierId: m.id, groupId: link.menu_modifier_groups.id, quantity: 1 })),
      ),
    );
    setQuantity(1);
    setNotes('');
    setShowErrors(false);
  }

  const groups = useMemo(
    () =>
      (item?.menu_item_modifier_groups ?? [])
        .map((link) => link.menu_modifier_groups)
        .filter((g) => g.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [item],
  );

  const violations = item ? validateModifierSelections(item, selections) : [];
  const lineTotal = item ? previewLineCents(item, selections, quantity) : 0;

  function toggle(groupId: string, modifierId: string, single: boolean, max: number | null) {
    setSelections((current) => {
      const already = current.some((s) => s.modifierId === modifierId);

      if (single) {
        // Required single-choice groups cannot be emptied by re-tapping.
        return [
          ...current.filter((s) => s.groupId !== groupId),
          ...(already ? [] : [{ modifierId, groupId, quantity: 1 }]),
        ];
      }

      if (already) return current.filter((s) => s.modifierId !== modifierId);

      const inGroup = current.filter((s) => s.groupId === groupId).length;
      if (max !== null && inGroup >= max) return current;

      return [...current, { modifierId, groupId, quantity: 1 }];
    });
  }

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="modifier-desc">
        <div className="overflow-y-auto px-5 pb-4 pt-5">
          <DialogTitle className="pr-8 text-lg font-semibold">{item.name}</DialogTitle>
          <DialogDescription id="modifier-desc" className="mt-1 text-sm text-neutral-600">
            {item.description ?? `${formatCents(item.price_cents, currency)} each`}
          </DialogDescription>

          {groups.map((group) => {
            const single = group.selection_type === 'single';
            const chosen = selections.filter((s) => s.groupId === group.id).length;
            const violated = showErrors && violations.some((v) => v.groupId === group.id);

            return (
              <fieldset key={group.id} className="mt-5">
                <legend className="flex w-full items-baseline justify-between gap-2 text-sm font-semibold">
                  <span>{group.name}</span>
                  <span
                    className={
                      violated ? 'text-xs font-medium text-red-600' : 'text-xs font-normal text-neutral-500'
                    }
                  >
                    {group.is_required ? 'Required' : 'Optional'}
                    {group.max_selections !== null && !single
                      ? ` · up to ${group.max_selections}`
                      : ''}
                  </span>
                </legend>

                <div className="mt-2 space-y-1">
                  {group.menu_modifiers
                    .slice()
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((modifier) => {
                      const checked = selections.some((s) => s.modifierId === modifier.id);
                      const atLimit =
                        !single &&
                        group.max_selections !== null &&
                        chosen >= group.max_selections &&
                        !checked;

                      return (
                        <label
                          key={modifier.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                            checked ? 'border-[var(--brand-primary)] bg-neutral-50' : 'border-neutral-200'
                          } ${!modifier.is_available || atLimit ? 'cursor-not-allowed opacity-45' : ''}`}
                        >
                          <input
                            type={single ? 'radio' : 'checkbox'}
                            name={group.id}
                            className="h-4 w-4 accent-[var(--brand-primary)]"
                            checked={checked}
                            disabled={!modifier.is_available || atLimit}
                            onChange={() =>
                              toggle(group.id, modifier.id, single, group.max_selections)
                            }
                          />
                          <span className="flex-1">
                            {modifier.name}
                            {!modifier.is_available ? (
                              <span className="ml-2 text-xs text-neutral-500">Unavailable</span>
                            ) : null}
                          </span>
                          {modifier.price_delta_cents !== 0 ? (
                            <span className="tabular-nums text-neutral-600">
                              {modifier.price_delta_cents > 0 ? '+' : '−'}
                              {formatCents(Math.abs(modifier.price_delta_cents), currency)}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                </div>
              </fieldset>
            );
          })}

          <div className="mt-5">
            <label htmlFor="line-notes" className="text-sm font-semibold">
              Notes for the kitchen
            </label>
            <Textarea
              id="line-notes"
              className="mt-2"
              maxLength={500}
              placeholder="No onions, please"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-neutral-200 bg-white px-5 py-4">
          <div className="flex items-center gap-1 rounded-lg border border-neutral-300">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Button
            className="flex-1"
            onClick={() => {
              if (violations.length > 0) {
                setShowErrors(true);
                return;
              }
              onAdd({
                menuItemId: item.id,
                quantity,
                modifiers: selections,
                notes: notes.trim() || undefined,
              });
              onOpenChange(false);
            }}
          >
            Add to Order — {formatCents(lineTotal, currency)}
          </Button>
        </div>

        {showErrors && violations.length > 0 ? (
          <p role="alert" className="px-5 pb-4 text-sm text-red-600">
            {violations[0].message}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
