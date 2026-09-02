/**
 * Retry policy for the outbound webhook outbox.
 *
 * Deliberately not in `dispatch.ts`: that module is `server-only`, and the
 * schedule is the part worth testing on its own.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}
