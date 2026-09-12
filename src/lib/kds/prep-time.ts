/** Validate the per-order kitchen estimate entered by an operator. */
export function parsePrepTime(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const minutes = Number(trimmed);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) return null;
  return minutes;
}

/** Keep the customer-facing promise aligned with the estimate the kitchen set. */
export function promisedAtFromNow(minutes: number, now = Date.now()): string {
  return new Date(now + minutes * 60_000).toISOString();
}
