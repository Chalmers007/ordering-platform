import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { resolveHost } from '@/lib/tenancy/host';
import type { TenantStatus } from '@/types/database';
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_HEADER,
  IMPERSONATION_SESSION_HEADER,
  verifyImpersonationToken,
} from '@/lib/admin/impersonation';

/**
 * Next.js request proxy: one request, three products.
 *
 * Next 16 renamed middleware to proxy. There must be exactly ONE of
 * these files: when both exist the build fails, and before it failed a
 * stale proxy.ts silently took precedence over the middleware being
 * edited — which is how routing fixes can appear to work locally and
 * ship broken.
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
/**
 * Set only for a storefront whose tenant is still `pending_claim`.
 *
 * Stripped from every inbound request alongside the other tenancy headers, so
 * a visitor cannot forge it — and it only ever REMOVES capability (it turns
 * ordering off), so forging it would gain nothing.
 */
export const TENANT_PREVIEW_HEADER = 'x-tenant-preview';

const SPOOFABLE_HEADERS = [
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  TENANT_NAME_HEADER,
  TENANT_STATUS_HEADER,
  SURFACE_HEADER,
  HOSTNAME_HEADER,
  TENANT_PREVIEW_HEADER,
  IMPERSONATION_HEADER,
  IMPERSONATION_SESSION_HEADER,
];

type StorefrontTenant = {
  tenant_id: string;
  slug: string;
  name: string;
  // The canonical enum, not a hand-copied union. The literal list here had
  // never been updated with 'pending_claim', so the middleware's own type did
  // not know the status existed — which is how every staged storefront fell
  // silently into the "not claimed yet" page.
  status: TenantStatus;
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

  // Emailed links (owner invitations, magic links, password recovery) land
  // on /auth/callback. It is one shared route, so it must not be rewritten
  // under a surface prefix any more than /api is.
  const isAuthRoute = pathname.startsWith('/auth/');

  // The claim link is how a restaurant takes possession of a storefront
  // that is deliberately NOT yet active, so this one path has to survive
  // both the surface rewrite and the status gate below. Everything else on
  // a pending tenant still refuses to serve.
  // Both the page AND its endpoint: /api/claim is how the storefront is
  // taken over, so blocking it on an unclaimed tenant makes claiming
  // impossible — and it fails as a 200 serving the "not claimed" page,
  // which looks like success to anything reading status codes.
  const isClaimRoute =
    pathname === '/claim' || pathname.startsWith('/claim/') || pathname === '/api/claim';

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

      if (isApiRoute || isAuthRoute) {
        // An unauthenticated API call must get a 401 from the handler, not a
        // redirect to an HTML login page — and the auth callback is what
        // creates the session, so it can never require one.
        return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
      }

      if (!user && !pathname.startsWith('/login')) {
        const login = request.nextUrl.clone();
        // The PUBLIC path, not the internal one. On this host the browser
        // asks for `/login`; `${prefix}/login` is only what we rewrite it to.
        // Redirecting to the rewritten path returns a URL whose pathname is
        // `/admin/login`, which does not start with `/login` — so the next
        // request redirects again and `next` nests forever.
        login.pathname = '/login';
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

      if (isClaimRoute) {
        return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
      }

      // A storefront awaiting its owner is SHOWN, not hidden.
      //
      // It was built from the restaurant's own published menu so they can see
      // what they would be buying before deciding — "Not claimed yet" leaves a
      // prospect nothing to look at. Every other non-active status stays
      // hidden: 'suspended' and 'cancelled' are storefronts that must go dark,
      // not demos.
      //
      // Viewing changes nothing: the tenant stays pending_claim, this header
      // is the only difference, and ordering is refused three independent ways
      // (see the storefront page).
      const isPreview = tenant.status === 'pending_claim';
      if (isPreview) requestHeaders.set(TENANT_PREVIEW_HEADER, '1');

      if (!isPreview && tenant.status !== 'active') {
        return applyCookies(
          rewrite(request, `/storefront-unavailable/${tenant.status}`, requestHeaders),
        );
      }

      if (isApiRoute || isAuthRoute) {
        return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
      }

      // On custom domains, allow staff to access /app, /login, and /admin paths
      // without rewriting them to /store. This enables owner dashboards on
      // restaurant-owned domains while keeping the storefront accessible at /.
      const isStaffPath = pathname.startsWith('/app') || pathname.startsWith('/login') || pathname.startsWith('/admin');
      if (isStaffPath) {
        // Pass through to the handler without rewriting. Staff auth checks
        // (role, tenant membership) happen server-side in the layout.
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
