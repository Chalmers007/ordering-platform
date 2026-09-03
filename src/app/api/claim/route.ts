import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/tenancy/context';

/**
 * Completes a storefront claim.
 *
 * Order matters here. The auth user must exist before `claim_tenant()` can
 * attach it, but the tenant must not be activated unless the whole thing
 * succeeds — so the token is re-checked inside that function under FOR
 * UPDATE, and if attaching fails after the user was created, the user is
 * removed again rather than left orphaned holding a half-claim.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().uuid(),
  email: z.string().email().max(254),
  // Long enough to matter, and checked here as well as by GoTrue so the
  // message is about the password rather than a generic auth failure.
  password: z.string().min(10).max(200),
  fullName: z.string().min(1).max(160),
  phone: z.string().max(32).optional(),
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Check the details below',
          fieldErrors: z.flattenError(error).fieldErrors,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const service = createServiceClient();

  // Verify before creating anything, so a bad link never leaves an account
  // behind. claim_tenant() checks again under a row lock — this is the
  // cheap early exit, not the guarantee.
  const { data: claimable, error: verifyError } = await service.rpc('verify_claim_token', {
    p_token: body.token,
  });

  if (verifyError) {
    return NextResponse.json({ error: 'Could not verify that link' }, { status: 500 });
  }

  const target = claimable?.[0];
  if (!target) {
    return NextResponse.json(
      { error: 'This claim link is not valid, has expired, or has already been used' },
      { status: 410 },
    );
  }

  // The link is scoped to one restaurant, so it must be used on that
  // restaurant's own subdomain. Otherwise a leaked token could be redeemed
  // from anywhere and the owner would never see the storefront they got.
  const tenant = await getTenantContext();
  if (tenant && tenant.tenantId !== target.tenant_id) {
    return NextResponse.json(
      { error: 'That link belongs to a different restaurant' },
      { status: 403 },
    );
  }

  // ---- the owner's account -------------------------------------------
  let userId: string;
  let createdUser = false;

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: body.email,
    password: body.password,
    phone: body.phone || undefined,
    email_confirm: true,
    user_metadata: { full_name: body.fullName, tenant_id: target.tenant_id },
  });

  if (created?.user) {
    userId = created.user.id;
    createdUser = true;
  } else {
    // Already registered is a normal case — someone the platform invited
    // earlier, or a second attempt after a network failure.
    const { data: existing } = await service
      .from('user_profiles')
      .select('id')
      .ilike('email', body.email)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: createError?.message ?? 'Could not create that account' },
        { status: 409 },
      );
    }
    userId = existing.id;
  }

  // ---- hand over the restaurant ---------------------------------------
  const { data: claimed, error: claimError } = await service.rpc('claim_tenant', {
    p_token: body.token,
    p_user_id: userId,
    p_email: body.email,
    p_full_name: body.fullName,
    p_phone: body.phone,
  });

  if (claimError || !claimed) {
    // Roll back the account we just made. Leaving it would let a second
    // attempt fail on "already registered" for an account nobody owns.
    if (createdUser) await service.auth.admin.deleteUser(userId).catch(() => undefined);

    return NextResponse.json(
      { error: claimError?.message ?? 'That link could not be redeemed' },
      { status: claimError?.code === '02000' ? 410 : 500 },
    );
  }

  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') ?? (root.startsWith('localhost') ? 'http' : 'https');

  return NextResponse.json({
    tenant: { id: claimed.id, name: claimed.name, slug: claimed.slug },
    // The browser signs in itself after this returns: doing it here would
    // set the session cookie on the storefront host, and the dashboard it
    // is being sent to is a different origin.
    redirectTo: `${proto}://app.${root}/kds`,
  });
}
