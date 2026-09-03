import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Uber Direct signs each webhook with HMAC-SHA256 of the raw body, keyed
 * on the endpoint's signing secret, in `X-Uber-Signature`.
 *
 * Pure and separate from the route so it can be tested against real
 * signatures without a network call — an unverified body is an attacker
 * claiming a delivery was completed.
 */
export function verifyUberSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signature.trim().toLowerCase();

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, which would turn a forged header into a 500.
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}
