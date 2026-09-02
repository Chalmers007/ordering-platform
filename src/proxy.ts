import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { resolveHost } from '@/lib/tenancy/host';
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_HEADER,
  IMPERSONATION_SESSION_HEADER,
  verifyImpersonationToken,
} from '@/lib/admin/impersonation';

/**
 * Next.js request proxy: one request, three products.
 *
 *   admin.<root>        -> /admin/*       platform super-admin
 *   app.<root>          -> /app/*         restaurant staff dashboard + KDS
 *   <tenant>.<root>     -> /store/*       white-labelled storefront
 *   orders.joespizza.com-> /store/*       ditto, on the tenant's own domain
 *   <root> / www        -> /(marketing)   platform marketing site
 *
 * Two things happen on every request:
 *   1. The Supabase auth session is refreshed, so Server Components always
 *      observe a live session. This is why the cookie plumbing below writes
 *      to a single response object rather than creating new ones.
 *   2. The tenant is resolved and pinned to request headers, so no page,
 *      layout, or Server Action ever has to re-parse the Host header or
 *      trust a tenant id from the client.
 */

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Headers the app reads via `headers()`. Stripped from every inbound
 *  request first so a client can never forge its own tenant. */
export const TENANT_ID_HEADER = 'x-tenant-id';
export const TENANT_SLUG_HEADER = 'x-tenant-slug';
export const TENANT_NAME_HEADER = 'x-tenant-name';
export const TENANT_STATUS_HEADER = 'x-tenant-status';
export const SURFACE_HEADER = 'x-surface';
export const HOSTNAME_HEADER = 'x-hostname';

const SPOOFABLE_HEADERS = [
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  TENANT_NAME_HEADER,
  TENANT_STATUS_HEADER,
  SURFACE_HEADER,
  HOSTNAME_HEADER,
  IMPERSONATION_HEADER,
  IMPERSONATION_SESSION_HEADER,
];

type StorefrontTenant = {
  tenant_id: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'suspended' | 'cancelled';
  is_custom_domain: boolean;
};

/**
 * Host -> tenant, memoised per edge instance.
 *
 * A storefront request cannot afford a database round trip for routing, and
 * the mapping changes only when an operator adds a domain. 60s of staleness
 * on a *routing* decision is fine; the page itself still reads live data.
 * Negative results are cached too — that is what stops an unknown-host flood
 * from turning into a database flood.
 */
const TTL_MS = 60_000;
const resolutionCache = new Map<string, { value: StorefrontTenant | null; expiresAt: number }>();

async function resolveTenant(
  hostname: string,
  slug: string | null,
): Promise<StorefrontTenant | null> {
  const cacheKey = `${hostname}|${slug ?? ''}`;
  const hit = resolutionCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value: StorefrontTenant | null = null;
  try {
    // Direct REST call rather than the JS client: the client's cookie/session
    // machinery is pure overhead for an unauthenticated routing lookup.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_storefront`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_hostname: hostname, p_slug: slug }),
      // Never let a slow database hang every storefront request.
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) {
      const rows = (await res.json()) as StorefrontTenant[];
      value = rows[0] ?? null;
    }
  } catch {
    // Network failure or timeout: fall through to a null resolution, which
    // renders the "storefront unavailable" page instead of a 500.
    value = null;
  }

  resolutionCache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

function rewrite(request: NextRequest, path: string, headers: Headers): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = path;
  return NextResponse.rewrite(url, { request: { headers } });
}

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  for (const header of SPOOFABLE_HEADERS) requestHeaders.delete(header);

  const hostname =
    request.headers.get('host') ?? request.nextUrl.hostname;
  const resolution = resolveHost(hostname, ROOT_DOMAIN);
  const { pathname, search } = request.nextUrl;

  requestHeaders.set(SURFACE_HEADER, resolution.surface);
  requestHeaders.set(HOSTNAME_HEADER, hostname);

  // ---- Auth session refresh ------------------------------------------
  // The response is created up front so both the Supabase cookie writes and
  // the eventual rewrite share one object. Creating a second NextResponse
  // after `getUser()` silently drops the refreshed session cookie.
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          requestHeaders.append('cookie', `${name}=${value}`);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Route handlers keep their own paths. Rewriting /api/stripe/webhook to
  // /admin/api/stripe/webhook would 404 every integration on the platform.
  // They still receive the resolved tenant headers.
  const isApiRoute = pathname.startsWith('/api');

  // Impersonation, on the two staff-facing surfaces only. The cookie is
  // verified here so nothing downstream has to trust a raw cookie value,
  // and the header it sets is what makes audit_logs.impersonated true.
  if (user && (resolution.surface === 'admin' || resolution.surface === 'app')) {
    const secret =
      process.env.IMPERSONATION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const claims = await verifyImpersonationToken(
      request.cookies.get(IMPERSONATION_COOKIE)?.value,
      secret,
    );

    // The token names the administrator it was issued to. If the session
    // has since changed hands, it is not honoured.
    if (claims && claims.adminId === user.id) {
      requestHeaders.set(IMPERSONATION_HEADER, claims.tenantId);
      requestHeaders.set(IMPERSONATION_SESSION_HEADER, claims.sid);
    }
  }

  const applyCookies = (target: NextResponse) => {
    for (const cookie of response.cookies.getAll()) {
      target.cookies.set(cookie);
    }
    return target;
  };

  // ---- Surface routing -----------------------------------------------
  switch (resolution.surface) {
    case 'marketing': {
      if (pathname.startsWith('/admin') || pathname.startsWith('/app') || pathname.startsWith('/store')) {
        return applyCookies(NextResponse.rewrite(new URL('/404', request.url), { request: { headers: requestHeaders } }));
      }
      return response;
    }

    case 'admin':
    case 'app': {
      const prefix = resolution.surface === 'admin' ? '/admin' : '/app';

      if (isApiRoute) {
        // An unauthenticated API call must get a 401 from the handler, not a
        // redirect to an HTML login page.
        return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
      }

      if (!user && !pathname.startsWith('/login')) {
        const login = request.nextUrl.clone();
        login.pathname = `${prefix}/login`;
        login.search = `?next=${encodeURIComponent(pathname + search)}`;
        return applyCookies(NextResponse.redirect(login));
      }

      // Authorisation itself is RLS plus a server-side is_super_admin() /
      // tenant-membership check in the layout. Middleware only decides *where
      // a request goes*; it must never be the only thing standing between a
      // user and data.
      return applyCookies(rewrite(request, `${prefix}${pathname === '/' ? '' : pathname}`, requestHeaders));
    }

    case 'storefront': {
      const slug = resolution.kind === 'subdomain' ? resolution.slug : null;
      const tenant = await resolveTenant(resolution.hostname, slug);

      if (!tenant) {
        return applyCookies(
          rewrite(request, '/storefront-unavailable/not-found', requestHeaders),
        );
      }

      requestHeaders.set(TENANT_ID_HEADER, tenant.tenant_id);
      requestHeaders.set(TENANT_SLUG_HEADER, tenant.slug);
      requestHeaders.set(TENANT_NAME_HEADER, encodeURIComponent(tenant.name));
      requestHeaders.set(TENANT_STATUS_HEADER, tenant.status);

      if (tenant.status !== 'active') {
        return applyCookies(
          rewrite(request, `/storefront-unavailable/${tenant.status}`, requestHeaders),
        );
      }

      if (isApiRoute) {
        return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
      }

      // A tenant reached by custom domain never sees its platform subdomain:
      // the rewrite is internal, so the address bar keeps the tenant's own
      // hostname. That is the whole point of white labelling.
      return applyCookies(rewrite(request, `/store${pathname === '/' ? '' : pathname}`, requestHeaders));
    }
  }
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/static, _next/image  - build output
     *   favicon.ico, robots.txt,
     *   sitemap.xml, manifest       - well-known static files
     *   *.<ext>                     - any other static asset
     *
     * /api IS matched: route handlers need the tenant headers too, and the
     * Shipday-proxy and webhook endpoints must not be reachable without a
     * resolved tenant.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|map)$).*)',
  ],
};
