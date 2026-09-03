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
 * This also selects the OAuth host — see uberAuthUrl().
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

export const UBER_SANDBOX_AUTH = 'https://sandbox-login.uber.com/oauth/v2/token';
export const UBER_PRODUCTION_AUTH = 'https://login.uber.com/oauth/v2/token';

/**
 * Where tokens come from.
 *
 * Uber runs a SEPARATE OAuth host per environment, and authenticating a
 * sandbox app against the production host fails with
 * `401 unauthorized_client` — a code that reads as a permissions or
 * provisioning problem and sends you to the developer dashboard, or to
 * support, for as long as it takes to read `error_description`:
 *
 *   "the current application environment is mismatched with the OAuth
 *    server runtime environment"
 *
 * So the auth host is derived from the same setting that picks the API
 * base. The two cannot drift apart, because a sandbox app pointed at the
 * production login is not a configuration anyone wants.
 */
export function uberAuthUrl(): string {
  const override = process.env.UBER_DIRECT_AUTH_URL?.trim();
  if (override) return override;
  return uberEnvironment() === 'sandbox' ? UBER_SANDBOX_AUTH : UBER_PRODUCTION_AUTH;
}
