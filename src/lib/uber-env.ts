/**
 * Which Uber environment we talk to.
 *
 * Separate from `uber.ts` because that module is `server-only`, which
 * cannot be imported under vitest — and the one thing here worth testing
 * is precisely the default, since getting it wrong costs real money.
 */

export const UBER_SANDBOX_BASE = 'https://sandbox-api.uber.com';
export const UBER_PRODUCTION_BASE = 'https://api.uber.com';

/**
 * Resolved per call, not captured at import, so the health check and the
 * dispatch path can never disagree about where an order is going.
 *
 * The default is SANDBOX, deliberately. An unset variable is an
 * unconfigured system, and an unconfigured system must not be able to
 * book a real courier to a real address and bill a real merchant.
 * Defaulting the other way makes a forgotten variable in a preview branch
 * expensive; defaulting this way makes it merely visible. Production sets
 * UBER_DIRECT_API_BASE explicitly, and the courier health check reports
 * both the resolved base and whether it was set on purpose.
 *
 * This does NOT affect OAuth: Uber issues tokens from login.uber.com for
 * both environments.
 */
export function uberApiBase(): string {
  const configured = process.env.UBER_DIRECT_API_BASE?.trim();
  return configured ? configured.replace(/\/+$/, '') : UBER_SANDBOX_BASE;
}

/** Whether the base was configured, as opposed to defaulted. */
export function uberApiBaseIsExplicit(): boolean {
  return Boolean(process.env.UBER_DIRECT_API_BASE?.trim());
}

export function uberEnvironment(): 'sandbox' | 'production' {
  return uberApiBase().includes('sandbox') ? 'sandbox' : 'production';
}
