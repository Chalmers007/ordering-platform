import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { CLAIM_SESSION_COOKIE } from '@/lib/claims/session';

/**
 * POST /api/claim/request
 *
 * Self-serve claim-token issuance for a prospect who clicks "Activate My
 * Storefront" on their own demo preview.
 *
 * There is deliberately no login and no phone call in this path. That is a
 * trade Scott made for scale, not an oversight — a claim token is a bearer
 * credential that hands the whole storefront to whoever redeems it, and
 * until now this codebase only ever issued one after someone at Vardr had
 * spoken to the business (see request_claim_token() in
 * supabase/migrations/20260913000100_self_serve_claim_token.sql for the
 * full rationale). Whoever calls this route first for a given tenant_id
 * gets to claim that restaurant; tenant_id is not treated as a secret,
 * since it already appears in the demo's own preview URL.
 *
 * The claim token itself never reaches the response body — it is written
 * straight to an httpOnly cookie, exactly as the sales-side demo builder
 * already does when an operator stages a demo — so it never touches
 * client-side JS, logs, or a redirect URL.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ tenant_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: token, error } = await service.rpc('request_claim_token', {
    p_tenant_id: body.tenant_id,
    p_ttl_days: 14,
  });

  if (error || !token) {
    // Every failure mode here (no such tenant, already claimed, wrong
    // status) is safe to say plainly: none of it is information a visitor
    // could not already infer from the storefront itself.
    const message = error?.message ?? '';
    const friendly = /already been claimed/i.test(message)
      ? 'This restaurant has already been claimed.'
      : /No such tenant/i.test(message)
        ? 'This demo could not be found.'
        : 'This demo is not available to claim right now.';
    return NextResponse.json({ error: friendly }, { status: 409 });
  }

  (await cookies()).set(CLAIM_SESSION_COOKIE, String(token), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 86_400,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
