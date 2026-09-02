import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { drainWebhookEvents } from '@/lib/webhooks/dispatch';

/**
 * Tenant provisioning.
 *
 * Three things have to happen together: the restaurant, its onboarding
 * defaults, and an owner who can sign in. `provision_tenant()` makes the
 * first two atomic in SQL; the owner needs an auth user, which only the
 * admin API can create, so that step is here — and if it fails the tenant is
 * rolled back rather than left with nobody able to reach it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z
    .string()
    .regex(/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/, 'Use lowercase letters, numbers and hyphens')
    .optional(),
  ownerEmail: z.string().email().max(254),
  ownerName: z.string().max(160).optional(),
  supportEmail: z.string().email().max(254).optional(),
  supportPhone: z.string().max(32).optional(),
  timezone: z.string().max(64).default('America/New_York'),
  currency: z.string().length(3).default('USD'),
  trialDays: z.number().int().min(0).max(365).default(14),
});

/** The staff dashboard origin for this deployment. */
function appOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('host') ?? '';
  return `${proto}://${host.replace(/^admin\./, 'app.')}`;
}

function statusForPostgresError(code: string | undefined): number {
  switch (code) {
    case '42501': return 403;
    case '23505': return 409; // unique_violation — the subdomain is taken
    case '23514': return 422; // check_violation — reserved or malformed slug
    case '02000': return 404;
    default: return 500;
  }
}

export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }

  const supabase = await createClientForRequest();
  const params = request.nextUrl.searchParams;

  // RLS lets a super admin read every tenant; a non-super-admin never gets
  // here, and would see only their own row if they did.
  let query = supabase
    .from('tenants')
    .select('*, tenant_settings(tech_fee_enabled, tech_fee_cents, is_kitchen_paused)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(params.get('limit') ?? 100), 500));

  const search = params.get('search')?.trim();
  if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);

  const status = params.get('status');
  if (status) query = query.eq('status', status as never);

  const subscription = params.get('subscription');
  if (subscription) query = query.eq('subscription_status', subscription as never);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tenants: data });
}

export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid restaurant details', fieldErrors: z.flattenError(error).fieldErrors },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const supabase = await createClientForRequest();

  // Step 1 — tenant + settings, atomically, under the caller's identity so
  // the audit trail records which administrator provisioned it.
  const { data: tenant, error: provisionError } = await supabase.rpc('provision_tenant', {
    p_name: body.name,
    p_slug: body.slug,
    p_support_email: body.supportEmail,
    p_support_phone: body.supportPhone,
    p_timezone: body.timezone,
    p_currency: body.currency,
    p_trial_days: body.trialDays,
  });

  if (provisionError || !tenant) {
    return NextResponse.json(
      { error: provisionError?.message ?? 'The restaurant could not be created' },
      { status: statusForPostgresError(provisionError?.code) },
    );
  }

  // Step 2 — the owner. Only the admin API can create an auth user, and
  // only assign_tenant_owner() can grant the tenant_owner role.
  const service = createServiceClient();
  let ownerId: string;

  try {
    const { data: invited, error: inviteError } =
      await service.auth.admin.inviteUserByEmail(body.ownerEmail, {
        data: { tenant_id: tenant.id, full_name: body.ownerName ?? null },
        // The invitation has to arrive somewhere that can exchange the
        // token for a session, or the owner cannot get in at all.
        redirectTo: `${appOrigin(request)}/auth/callback?next=/`,
      });

    if (inviteError || !invited?.user) throw new Error(inviteError?.message ?? 'Invite failed');
    ownerId = invited.user.id;
  } catch (inviteError) {
    // An email that already has an account is a normal case — reuse it
    // rather than failing the whole provisioning.
    const { data: existing } = await service
      .from('user_profiles')
      .select('id')
      .eq('email', body.ownerEmail)
      .maybeSingle();

    if (!existing) {
      // Nobody can reach this restaurant, so it must not exist. RLS lets a
      // super admin delete, and the cascade takes the settings with it.
      await supabase.from('tenants').delete().eq('id', tenant.id);
      return NextResponse.json(
        {
          error:
            inviteError instanceof Error
              ? `The owner could not be invited: ${inviteError.message}`
              : 'The owner could not be invited',
        },
        { status: 502 },
      );
    }
    ownerId = existing.id;
  }

  const { error: ownerError } = await supabase.rpc('assign_tenant_owner', {
    p_tenant_id: tenant.id,
    p_user_id: ownerId,
    p_full_name: body.ownerName,
    p_email: body.ownerEmail,
  });

  if (ownerError) {
    await supabase.from('tenants').delete().eq('id', tenant.id);
    return NextResponse.json(
      { error: `The owner could not be assigned: ${ownerError.message}` },
      { status: statusForPostgresError(ownerError.code) },
    );
  }

  // Step 3 — drain the outbox now. The rows were enqueued transactionally;
  // this is the immediate attempt so an invitation does not sit in a queue
  // waiting for a scheduler that may not be configured yet.
  const delivery = await drainWebhookEvents(tenant.id).catch(() => null);

  return NextResponse.json(
    {
      tenant,
      ownerId,
      notifications: delivery ?? { delivered: 0, failed: 0, skipped: 0 },
    },
    { status: 201 },
  );
}
