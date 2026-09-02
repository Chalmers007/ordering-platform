import { describe, expect, it } from 'vitest';
import { lineKey } from './line-key';
import { previewLineCents, validateModifierSelections } from './modifier-rules';
import { orderingAvailability } from '@/lib/storefront/availability';
import type { MenuItemWithModifiers, TenantSettings } from '@/types/database';

const GROUP_SIZE = '00000000-0000-0000-0000-00000000g001'.replace(/g/g, 'a');
const GROUP_EXTRAS = '00000000-0000-0000-0000-00000000g002'.replace(/g/g, 'b');

function item(): MenuItemWithModifiers {
  const base = {
    id: '11111111-2222-3333-4444-555555555555',
    price_cents: 1400,
  } as unknown as MenuItemWithModifiers;

  return {
    ...base,
    menu_item_modifier_groups: [
      {
        menu_modifier_groups: {
          id: GROUP_SIZE,
          name: 'Size',
          selection_type: 'single',
          is_required: true,
          is_active: true,
          min_selections: 1,
          max_selections: 1,
          sort_order: 0,
          menu_modifiers: [
            { id: 'aaaa1111-0000-0000-0000-000000000001', name: 'Small', price_delta_cents: 0, is_available: true, is_default: true, sort_order: 0 },
            { id: 'aaaa1111-0000-0000-0000-000000000002', name: 'Large', price_delta_cents: 400, is_available: true, is_default: false, sort_order: 1 },
          ],
        },
      },
      {
        menu_modifier_groups: {
          id: GROUP_EXTRAS,
          name: 'Extras',
          selection_type: 'multiple',
          is_required: false,
          is_active: true,
          min_selections: 0,
          max_selections: 2,
          sort_order: 1,
          menu_modifiers: [
            { id: 'bbbb1111-0000-0000-0000-000000000001', name: 'Extra cheese', price_delta_cents: 150, is_available: true, is_default: false, sort_order: 0 },
            { id: 'bbbb1111-0000-0000-0000-000000000002', name: 'Olives', price_delta_cents: 100, is_available: true, is_default: false, sort_order: 1 },
            { id: 'bbbb1111-0000-0000-0000-000000000003', name: 'Basil', price_delta_cents: 0, is_available: true, is_default: false, sort_order: 2 },
          ],
        },
      },
    ],
  } as unknown as MenuItemWithModifiers;
}

const SMALL = { modifierId: 'aaaa1111-0000-0000-0000-000000000001', groupId: GROUP_SIZE, quantity: 1 };
const CHEESE = { modifierId: 'bbbb1111-0000-0000-0000-000000000001', groupId: GROUP_EXTRAS, quantity: 1 };
const OLIVES = { modifierId: 'bbbb1111-0000-0000-0000-000000000002', groupId: GROUP_EXTRAS, quantity: 1 };
const BASIL = { modifierId: 'bbbb1111-0000-0000-0000-000000000003', groupId: GROUP_EXTRAS, quantity: 1 };

describe('cart line identity', () => {
  it('merges the same item with the same options', () => {
    expect(lineKey('item-1', [SMALL, CHEESE])).toBe(lineKey('item-1', [CHEESE, SMALL]));
  });

  it('keeps differently-configured lines apart', () => {
    expect(lineKey('item-1', [SMALL])).not.toBe(lineKey('item-1', [SMALL, CHEESE]));
  });

  it('treats a different kitchen note as a different line', () => {
    // Merging these would silently drop one customer's instruction.
    expect(lineKey('item-1', [SMALL], 'no onions')).not.toBe(lineKey('item-1', [SMALL]));
  });
});

describe('modifier group rules', () => {
  it('requires a choice in a required group', () => {
    const violations = validateModifierSelections(item(), []);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/Choose an option for Size/);
  });

  it('accepts a valid selection', () => {
    expect(validateModifierSelections(item(), [SMALL])).toHaveLength(0);
  });

  it('rejects more than the group allows', () => {
    const violations = validateModifierSelections(item(), [SMALL, CHEESE, OLIVES, BASIL]);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/at most 2 for Extras/);
  });

  it('prices the preview from the item and its selected options', () => {
    expect(previewLineCents(item(), [SMALL, CHEESE], 2)).toBe((1400 + 150) * 2);
  });
});

describe('ordering availability', () => {
  const settings = (patch: Partial<TenantSettings>) =>
    ({
      is_kitchen_paused: false,
      kitchen_paused_reason: null,
      accepts_delivery: true,
      accepts_pickup: true,
      ...patch,
    }) as TenantSettings;

  it('blocks ordering while the kitchen is paused', () => {
    const result = orderingAvailability(
      settings({ is_kitchen_paused: true, kitchen_paused_reason: 'Fryer down' }),
    );
    expect(result.canOrder).toBe(false);
    expect(result.reason).toBe('Fryer down');
  });

  it('still explains itself when staff paused without a reason', () => {
    const result = orderingAvailability(settings({ is_kitchen_paused: true }));
    expect(result.canOrder).toBe(false);
    expect(result.reason).toMatch(/paused new orders/);
  });

  it('blocks when neither delivery nor pickup is offered', () => {
    expect(
      orderingAvailability(settings({ accepts_delivery: false, accepts_pickup: false })).canOrder,
    ).toBe(false);
  });

  it('allows ordering normally', () => {
    expect(orderingAvailability(settings({})).canOrder).toBe(true);
  });
});
