import { describe, expect, it } from 'vitest';
import { diffAuditRow, isMoneyField } from './diff';

describe('audit diff', () => {
  it('shows a kitchen pause as a before/after pair', () => {
    const diffs = diffAuditRow(
      { is_kitchen_paused: false, kitchen_paused_reason: null, updated_at: 'a' },
      { is_kitchen_paused: true, kitchen_paused_reason: 'Fryer down', updated_at: 'b' },
      ['is_kitchen_paused', 'kitchen_paused_reason', 'updated_at'],
    );

    expect(diffs).toEqual([
      { field: 'is_kitchen_paused', before: 'false', after: 'true', kind: 'changed' },
      { field: 'kitchen_paused_reason', before: '—', after: 'Fryer down', kind: 'changed' },
    ]);
  });

  it('drops timestamps that move on every write', () => {
    // updated_at changes on every single row; surfacing it buries the field
    // the reader actually came for.
    const diffs = diffAuditRow({ updated_at: 'a', price_cents: 100 }, { updated_at: 'b', price_cents: 100 });
    expect(diffs).toEqual([]);
  });

  it('reports a price change with both values', () => {
    const diffs = diffAuditRow({ price_cents: 1400 }, { price_cents: 1600 }, ['price_cents']);
    expect(diffs).toEqual([
      { field: 'price_cents', before: '1400', after: '1600', kind: 'changed' },
    ]);
  });

  it('marks inserts and deletes', () => {
    expect(diffAuditRow(null, { name: 'Margherita' })[0]).toMatchObject({ kind: 'added' });
    expect(diffAuditRow({ name: 'Margherita' }, null)[0]).toMatchObject({ kind: 'removed' });
  });

  it('falls back to comparing both objects when changed_fields is absent', () => {
    const diffs = diffAuditRow({ a: 1, b: 2 }, { a: 1, b: 3 }, null);
    expect(diffs.map((d) => d.field)).toEqual(['b']);
  });

  it('ignores fields named as changed that did not actually change', () => {
    expect(diffAuditRow({ a: 1 }, { a: 1 }, ['a'])).toEqual([]);
  });

  it('renders empty strings and nulls distinguishably', () => {
    const diffs = diffAuditRow({ note: 'x' }, { note: '' }, ['note']);
    expect(diffs[0].after).toBe('(empty)');
    expect(diffAuditRow({ note: 'x' }, { note: null }, ['note'])[0].after).toBe('—');
  });

  it('identifies money columns so cents are not misread as dollars', () => {
    expect(isMoneyField('price_cents')).toBe(true);
    expect(isMoneyField('tech_fee_cents')).toBe(true);
    expect(isMoneyField('estimated_prep_time_mins')).toBe(false);
  });
});
