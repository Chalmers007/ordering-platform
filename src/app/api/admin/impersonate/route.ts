import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClientForRequest } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_MS,
  impersonationCookieOptions,
  impersonationSecret,
  signImpersonationToken,
} from '@/lib/admin/impersonation';

/**
 * Start and end impersonation.
 *
 * POST records a session and issues a signed cookie naming the target
 * tenant. It does NOT issue a new identity: the administrator keeps their
 * own session throughout, so every subsequent write is still attributed to
 * them in `audit_logs` — which is the whole point of doing it this way
 * rather than minting a tenant-scoped JWT.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }

  let body: z.infer<typeof startSchema>;
  try {
    body = startSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'A tenantId is required' }, { status: 422 });
  }

  const supabase = await createClientForRequest();
  const { data: session, error } = await supabase.rpc('start_impersonation', {
    p_tenant_id: body.tenantId,
    p_reason: body.reason,
  });

  if (error || !session) {
    return NextResponse.json(
      { error: error?.message ?? 'Impersonation could not be started' },
      { status: error?.code === '42501' ? 403 : error?.code === '02000' ? 404 : 500 },
    );
  }

  const token = await signImpersonationToken(
    {
      sid: session.id,
      tenantId: session.tenant_id,
      adminId: guard.context.userId,
      iat: Date.now(),
    },
    impersonationSecret(),
  );

  // Impersonation is for working inside a restaurant, so it ends on the
  // staff dashboard, not on the console it was started from.
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') ?? (root.startsWith('localhost') ? 'http' : 'https');
  const redirectTo = `${proto}://app.${root}`;

  // A browser form POST follows a 303 natively. A fetch() caller cannot:
  // it transparently follows redirects and can never read the Location
  // header, so it gets the target in the body and navigates itself.
  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');

  const response = wantsHtml
    ? NextResponse.redirect(redirectTo, 303)
    : NextResponse.json({ session, redirectTo });

  response.cookies.set(IMPERSONATION_COOKIE, token, {
    ...impersonationCookieOptions(),
    maxAge: Math.floor(IMPERSONATION_TTL_MS / 1000),
  });
  return response;
}

export async function DELETE() {
  const supabase = await createClientForRequest();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Deliberately not behind requireSuperAdmin: exiting impersonation must
  // work even if the administrator's own access was revoked mid-session.
  // The RPC scopes itself to auth.uid() regardless.
  if (user) await supabase.rpc('end_impersonation');

  const response = NextResponse.json({ ended: true });
  // Same scope as it was set with, or the browser keeps sending it.
  response.cookies.set(IMPERSONATION_COOKIE, '', {
    ...impersonationCookieOptions(),
    maxAge: 0,
  });
  return response;
}
