/**
 * Host parsing for the three-surface routing model.
 *
 * Pure functions, zero I/O — the middleware needs this to be cheap and
 * unit-testable, because it runs on literally every request.
 */

export type Surface = 'admin' | 'app' | 'storefront' | 'marketing';

export type HostResolution =
  | { surface: 'admin' | 'app' | 'marketing' }
  | { surface: 'storefront'; kind: 'subdomain'; slug: string; hostname: string }
  | { surface: 'storefront'; kind: 'custom-domain'; hostname: string };

/** Subdomains the platform owns. Mirrored by the `reserved_subdomains` table,
 *  which is what actually stops a tenant from claiming one. */
export const ADMIN_SUBDOMAIN = 'admin';
export const APP_SUBDOMAIN = 'app';
export const MARKETING_SUBDOMAINS = new Set(['', 'www']);

/** Strip the port and any trailing dot, and lowercase. `Host` headers are
 *  attacker-controlled, so nothing downstream should ever see a raw one. */
export function normalizeHost(rawHost: string | null | undefined): string {
  if (!rawHost) return '';
  return rawHost
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/**
 * Split a hostname against the platform root domain.
 *
 * Returns `null` when the host is not under the root domain at all — that is
 * the custom-domain case (orders.joespizza.com), which needs a database
 * lookup rather than string parsing.
 */
export function subdomainOf(hostname: string, rootDomain: string): string | null {
  const host = normalizeHost(hostname);
  const root = normalizeHost(rootDomain);
  if (!root || !host) return null;
  if (host === root) return '';
  if (!host.endsWith(`.${root}`)) return null;
  return host.slice(0, -(root.length + 1));
}

/**
 * Classify a request host without touching the network.
 *
 * Local development is a first-class case: `admin.localhost:3000` and
 * `joes.localhost:3000` resolve exactly like their production equivalents,
 * so nobody has to edit /etc/hosts or reason about a second code path.
 */
export function resolveHost(rawHost: string, rootDomain: string): HostResolution {
  const hostname = normalizeHost(rawHost);
  const sub = subdomainOf(hostname, rootDomain);

  // Not under the platform root domain -> a tenant's own domain.
  if (sub === null) {
    return { surface: 'storefront', kind: 'custom-domain', hostname };
  }

  if (MARKETING_SUBDOMAINS.has(sub)) return { surface: 'marketing' };
  if (sub === ADMIN_SUBDOMAIN) return { surface: 'admin' };
  if (sub === APP_SUBDOMAIN) return { surface: 'app' };

  // Vercel preview deployments (ordering-platform-git-abc.vercel.app) and
  // any other multi-label host under the root are not tenant storefronts.
  if (sub.includes('.')) return { surface: 'marketing' };

  return { surface: 'storefront', kind: 'subdomain', slug: sub, hostname };
}
