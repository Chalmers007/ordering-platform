import { describe, expect, it } from 'vitest';
import { normalizeHost, resolveHost, subdomainOf } from './host';

describe('normalizeHost', () => {
  it('lowercases, strips the port and a trailing dot', () => {
    expect(normalizeHost('Admin.Platform.COM:3000')).toBe('admin.platform.com');
    expect(normalizeHost('joes.platform.com.')).toBe('joes.platform.com');
  });

  it('tolerates a missing Host header', () => {
    expect(normalizeHost(null)).toBe('');
    expect(normalizeHost(undefined)).toBe('');
  });
});

describe('subdomainOf', () => {
  it('returns an empty label for the apex', () => {
    expect(subdomainOf('platform.com', 'platform.com')).toBe('');
  });

  it('returns null for a host outside the root domain', () => {
    expect(subdomainOf('orders.joespizza.com', 'platform.com')).toBeNull();
  });

  it('does not treat a suffix collision as a subdomain', () => {
    // "notplatform.com" ends with "platform.com" as a *string* but is a
    // different domain. Getting this wrong hands an attacker a storefront.
    expect(subdomainOf('notplatform.com', 'platform.com')).toBeNull();
  });

  it('strips ports before extracting a local tenant slug', () => {
    expect(subdomainOf('joespizza.localhost:3000', 'localhost')).toBe('joespizza');
    expect(subdomainOf('joespizza.localhost:3000', 'localhost:3000')).toBe('joespizza');
  });
});

describe('resolveHost', () => {
  const ROOT = 'platform.com';

  it('routes the apex and www to marketing', () => {
    expect(resolveHost('platform.com', ROOT)).toEqual({ surface: 'marketing' });
    expect(resolveHost('www.platform.com', ROOT)).toEqual({ surface: 'marketing' });
  });

  it('routes the reserved platform subdomains', () => {
    expect(resolveHost('admin.platform.com', ROOT)).toEqual({ surface: 'admin' });
    expect(resolveHost('app.platform.com', ROOT)).toEqual({ surface: 'app' });
  });

  it('routes a tenant subdomain to the storefront', () => {
    expect(resolveHost('joes.platform.com', ROOT)).toEqual({
      surface: 'storefront',
      kind: 'subdomain',
      slug: 'joes',
      hostname: 'joes.platform.com',
    });
  });

  it('routes an unrelated host as a custom domain', () => {
    expect(resolveHost('orders.joespizza.com', ROOT)).toEqual({
      surface: 'storefront',
      kind: 'custom-domain',
      hostname: 'orders.joespizza.com',
    });
  });

  it('does not treat a Vercel preview host as a tenant', () => {
    // A multi-label subdomain is never a slug: tenant slugs cannot contain
    // a dot, so this must not resolve to a storefront lookup.
    expect(resolveHost('ordering-platform-git-abc.preview.platform.com', ROOT))
      .toEqual({ surface: 'marketing' });
  });

  it('works identically in local development', () => {
    expect(resolveHost('admin.localhost:3000', 'localhost')).toEqual({ surface: 'admin' });
    expect(resolveHost('joes.localhost:3000', 'localhost')).toEqual({
      surface: 'storefront',
      kind: 'subdomain',
      slug: 'joes',
      hostname: 'joes.localhost',
    });
    expect(resolveHost('localhost:3000', 'localhost')).toEqual({ surface: 'marketing' });
    expect(resolveHost('joespizza.localhost:3000', 'localhost:3000')).toEqual({
      surface: 'storefront',
      kind: 'subdomain',
      slug: 'joespizza',
      hostname: 'joespizza.localhost',
    });
  });

  it('is case-insensitive on the Host header', () => {
    expect(resolveHost('JOES.Platform.Com', ROOT)).toMatchObject({ slug: 'joes' });
  });
});
