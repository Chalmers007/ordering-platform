export type FieldDiff = {
  field: string;
  before: string;
  after: string;
  kind: 'added' | 'removed' | 'changed';
};

const NOISE = new Set(['updated_at', 'created_at']);

function render(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * old_data vs new_data, as a field list.
 *
 * `changed_fields` is already computed by the audit trigger, but it is only
 * names — this is what turns "status changed" into "status: preparing →
 * ready", which is the difference between an audit log you can read and two
 * walls of JSON.
 *
 * Timestamps that move on every write are dropped: they are not what anyone
 * is looking for and they bury the field that is.
 */
export function diffAuditRow(
  oldData: unknown,
  newData: unknown,
  changedFields?: string[] | null,
): FieldDiff[] {
  const before = (oldData ?? {}) as Record<string, unknown>;
  const after = (newData ?? {}) as Record<string, unknown>;

  const fields =
    changedFields && changedFields.length > 0
      ? changedFields
      : Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  const diffs: FieldDiff[] = [];

  for (const field of fields.slice().sort()) {
    if (NOISE.has(field)) continue;

    const hadBefore = field in before;
    const hasAfter = field in after;
    const previous = before[field];
    const next = after[field];

    if (hadBefore && hasAfter && JSON.stringify(previous) === JSON.stringify(next)) continue;

    diffs.push({
      field,
      before: render(previous),
      after: render(next),
      kind: !hadBefore ? 'added' : !hasAfter ? 'removed' : 'changed',
    });
  }

  return diffs;
}

/** Money columns are integer cents; showing "2100 → 2500" in an audit view
 *  invites the reader to misread it as dollars. */
export function isMoneyField(field: string): boolean {
  return /_cents$/.test(field);
}
