import type { CartLine, CartModifierSelection } from '@/types/database';

/**
 * Two cart lines are the same line when they are the same item with the same
 * options and the same note. Keying on `menuItemId` alone would merge a plain
 * pizza with an extra-cheese one; keying on a random id would never merge
 * anything and the cart would fill with duplicates.
 */
export function lineKey(
  menuItemId: string,
  modifiers: CartModifierSelection[],
  notes?: string,
): string {
  const canonical = [...modifiers]
    .map((m) => `${m.modifierId}:${m.quantity}`)
    .sort()
    .join('|');
  return `${menuItemId}#${canonical}#${(notes ?? '').trim()}`;
}

export function keyOf(line: CartLine): string {
  return lineKey(line.menuItemId, line.modifiers, line.notes);
}
