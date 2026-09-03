import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison for the provisioning bridge secret.
 *
 * PURE, and deliberately in its own module: the guard that uses it is
 * `server-only`, which cannot be imported by a test runner, and a credential
 * comparison is exactly the code that must be tested.
 *
 * A leaked bridge secret is worth an admin password — the endpoint behind it
 * creates tenants and mints claim tokens, and a claim token grants OWNERSHIP of
 * a storefront. So:
 *
 *   * constant time, because a byte-at-a-time comparison leaks the secret to
 *     anyone who can measure a few thousand requests;
 *   * an unset secret DISABLES the machine path rather than allowing everyone
 *     through, which is the failure a missing-env bug would otherwise cause;
 *   * a short secret is refused outright, so an operator who sets
 *     PROVISION_BRIDGE_SECRET=test finds out immediately.
 */
export const MIN_BRIDGE_SECRET_LENGTH = 32;

export function secretMatches(presented: string | null | undefined, expected: string | undefined): boolean {
  const want = expected?.trim() ?? '';
  if (want.length < MIN_BRIDGE_SECRET_LENGTH) return false;
  const got = presented?.trim() ?? '';
  if (!got) return false;

  const a = Buffer.from(got, 'utf8');
  const b = Buffer.from(want, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal and a 500. Compare same-length buffers, then fold the real lengths
  // back into the result.
  const len = Math.max(a.length, b.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

/** Extracts the token from an `Authorization: Bearer …` header. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
