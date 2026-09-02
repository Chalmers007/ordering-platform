import type { CartModifierSelection, MenuItemWithModifiers } from '@/types/database';

export type ModifierRuleViolation = {
  groupId: string;
  groupName: string;
  message: string;
};

/**
 * Client-side mirror of the group rules `price_cart()` enforces in SQL.
 *
 * This exists to keep the modal honest while the customer is choosing — it is
 * NOT the enforcement. The database re-checks every rule, and the checkout
 * route re-prices from scratch, so a client that skips this simply gets a
 * rejection later instead of a wrong price.
 */
export function validateModifierSelections(
  item: MenuItemWithModifiers,
  selections: CartModifierSelection[],
): ModifierRuleViolation[] {
  const violations: ModifierRuleViolation[] = [];

  for (const link of item.menu_item_modifier_groups) {
    const group = link.menu_modifier_groups;
    if (!group.is_active) continue;

    const chosen = selections
      .filter((s) => s.groupId === group.id)
      .reduce((n, s) => n + s.quantity, 0);

    const min = group.is_required ? Math.max(group.min_selections, 1) : group.min_selections;

    if (group.is_required && chosen < min) {
      violations.push({
        groupId: group.id,
        groupName: group.name,
        message:
          min === 1 ? `Choose an option for ${group.name}` : `Choose at least ${min} for ${group.name}`,
      });
      continue;
    }

    if (chosen > 0 && chosen < group.min_selections) {
      violations.push({
        groupId: group.id,
        groupName: group.name,
        message: `Choose at least ${group.min_selections} for ${group.name}`,
      });
    }

    if (group.max_selections !== null && chosen > group.max_selections) {
      violations.push({
        groupId: group.id,
        groupName: group.name,
        message: `Choose at most ${group.max_selections} for ${group.name}`,
      });
    }
  }

  return violations;
}

/** Preview only. The database is the authority on price. */
export function previewLineCents(
  item: MenuItemWithModifiers,
  selections: CartModifierSelection[],
  quantity: number,
): number {
  const modifierDelta = item.menu_item_modifier_groups
    .flatMap((l) => l.menu_modifier_groups.menu_modifiers)
    .reduce((sum, modifier) => {
      const picked = selections.find((s) => s.modifierId === modifier.id);
      return picked ? sum + modifier.price_delta_cents * picked.quantity : sum;
    }, 0);

  return (item.price_cents + modifierDelta) * quantity;
}
