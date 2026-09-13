import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { CLAIM_SESSION_COOKIE } from '@/lib/claims/session';

/**
 * POST /api/claim/recover
 *
 * Re-establishes the claim-session cookie by email instead of by URL token.
 *
 * The claim-session cookie is set on the tenant's own preview subdomain
 * (see proxy.ts / preview-banner.tsx), but a GHL Payment Link has one fixed
 * redirect URL shared by every buyer of that plan - it cannot send each
 * buyer back to their own subdomain the way a per-session Stripe success_url
 * can. So a buyer coming back from GHL usually lands on a host that never
 * had their cookie set on it in the first place.
 *
 * This recovers the same session a valid cookie would have given them,
 * using only the email tied to a payment we've already confirmed - the
 * same email match /api/webhooks/ghl used to confirm it in the first
 * place. It never reveals whether an email exists in this table before
 * that email has a confirmed purchase, and never reveals which tenant to
 * anyone but the browser that receives the cookie.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email().max(254) });

export async function POST(request: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Enter a valid email' }, { status: 422 });
  }

  const service = createServiceClient();
  const email = body.email.trim().toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: purchase } = await (service as any)
    .from('package_purchases')
    .select('tenant_id')
    .eq('customer_email', email)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const genericError = 'No confirmed payment found for that email. If you just paid, wait a few seconds and try again.';

  if (!purchase) {
    return NextResponse.json({ error: genericError }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenant } = await (service as any)
    .from('tenants')
    .select('claim_token')
    .eq('id', purchase.tenant_id)
    .eq('status', 'pending_claim')
    .not('claim_token', 'is', null)
    .maybeSingle();

  if (!tenant?.claim_token) {
    return NextResponse.json(
      { error: 'This restaurant has already been claimed. Try logging in instead.' },
      { status: 409 },
    );
  }

  (await cookies()).set(CLAIM_SESSION_COOKIE, tenant.claim_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 86_400,
  });

  return NextResponse.json({ ok: true });
}
