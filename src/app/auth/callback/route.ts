import { NextResponse, type NextRequest } from 'next/server';
import { createClientForRequest } from '@/lib/supabase/server';

/**
 * Auth callback.
 *
 * Where every emailed link lands: the owner invitation that tenant
 * provisioning sends, magic links, and password recovery. Without it those
 * links arrive at a page that cannot see the token — the credentials come
 * back either in a `?code=` (PKCE) or as `token_hash` + `type`, and neither
 * establishes a session on its own.
 *
 * Shared by all three surfaces: middleware passes `/auth/*` through without
 * a surface rewrite, exactly as it does for `/api`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERIFIABLE = new Set([
  'magiclink',
  'signup',
  'invite',
  'recovery',
  'email_change',
  'email',
]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Only same-origin relative paths: an open redirect here would let a
  // crafted link bounce a freshly authenticated user to another site.
  const requested = params.get('next') ?? '/';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  /**
   * Build redirects from the Host header, not from `request.url`.
   *
   * `request.url` does not reliably carry the subdomain here, and this
   * platform IS its subdomains: dropping `app.` sends a signed-in cook to
   * the marketing site instead of the kitchen.
   */
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('host') ?? request.nextUrl.host;
  const origin = `${proto}://${host}`;

  const failure = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  const supabase = await createClientForRequest();

  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure('link_invalid');
    return NextResponse.redirect(`${origin}${next}`);
  }

  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && type && VERIFIABLE.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'magiclink' | 'signup' | 'invite' | 'recovery' | 'email_change' | 'email',
      token_hash: tokenHash,
    });
    if (error) return failure('link_expired');
    return NextResponse.redirect(`${origin}${next}`);
  }

  return failure('link_missing');
}
