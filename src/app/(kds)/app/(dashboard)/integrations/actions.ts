'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { getStripe } from '@/lib/payments/stripe';
import { fail, ok, type ActionResult } from '@/types/database';

/**
 * Integrations.
 *
 * Two things live here that look similar and are not: the Stripe connected
 * account, whose identifier is public-ish and lives in
 * `payment_gateway_accounts`, and outbound webhook/POS credentials, which
 * are secrets and live in `tenant_secrets` — a table with RLS enabled,
 * zero policies and zero grants, reachable only by the service role.
 */

async function dashboardOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * Starts (or resumes) Stripe Express onboarding.
 *
 * Express rather than Standard because the platform needs to take an
 * application fee off each charge, and Stripe hosts the onboarding — so no
 * bank details ever touch this application.
 */
export async function startStripeOnboarding(): Promise<ActionResult<{ url: string }>> {
  const staff = await resolveStaffTenantId();
  if (!staff) return fail('You do not have access to this restaurant', { code: 'forbidden' });
  if (!staff.canManage) {
    return fail('Only the restaurant owner can connect a payment account', { code: 'forbidden' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return fail(
      'Stripe is not configured on this deployment yet. Set STRIPE_SECRET_KEY and redeploy.',
      { code: 'gateway' },
    );
  }

  const supabase = await createClientForRequest();
  const service = createServiceClient();
  const stripe = getStripe();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, support_email, currency')
    .eq('id', staff.tenantId)
    .maybeSingle();

  const { data: existing } = await supabase
    .from('payment_gateway_accounts')
    .select('external_account_id')
    .eq('tenant_id', staff.tenantId)
    .eq('provider', 'stripe')
    .maybeSingle();

  try {
    let accountId = existing?.external_account_id ?? null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: tenant?.support_email ?? undefined,
        business_profile: { name: tenant?.name ?? undefined },
        // The platform collects the fee, so it owns the charge and the
        // resulting Stripe fees; the restaurant owns payouts.
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { tenant_id: staff.tenantId },
      });
      accountId = account.id;

      const { error } = await service.from('payment_gateway_accounts').upsert(
        {
          tenant_id: staff.tenantId,
          provider: 'stripe',
          status: 'onboarding',
          external_account_id: accountId,
          account_type: 'express',
          is_default: true,
          livemode: (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_'),
        },
        { onConflict: 'tenant_id,provider' },
      );
      if (error) return fail(`Could not record the account: ${error.message}`, { code: 'unknown' });
    }

    const origin = await dashboardOrigin();
    const link = await stripe.accountLinks.create({
      account: accountId,
      // Stripe onboarding can be abandoned and resumed; both land back here.
      refresh_url: `${origin}/integrations?stripe=refresh`,
      return_url: `${origin}/integrations?stripe=return`,
      type: 'account_onboarding',
    });

    return ok({ url: link.url });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Stripe onboarding failed', {
      code: 'gateway',
    });
  }
}

/** Pulls the live capability flags. Onboarding completion is asynchronous —
 *  the return_url fires before Stripe has finished verifying. */
export async function refreshStripeStatus(): Promise<ActionResult<{ chargesEnabled: boolean }>> {
  const staff = await resolveStaffTenantId();
  if (!staff?.canManage) return fail('Not permitted', { code: 'forbidden' });
  if (!process.env.STRIPE_SECRET_KEY) return fail('Stripe is not configured', { code: 'gateway' });

  const service = createServiceClient();
  const { data: row } = await service
    .from('payment_gateway_accounts')
    .select('external_account_id')
    .eq('tenant_id', staff.tenantId)
    .eq('provider', 'stripe')
    .maybeSingle();

  if (!row?.external_account_id) return fail('No Stripe account connected yet', { code: 'not_found' });

  try {
    const account = await getStripe().accounts.retrieve(row.external_account_id);
    const chargesEnabled = Boolean(account.charges_enabled);

    await service
      .from('payment_gateway_accounts')
      .update({
        charges_enabled: chargesEnabled,
        payouts_enabled: Boolean(account.payouts_enabled),
        details_submitted: Boolean(account.details_submitted),
        status: chargesEnabled ? 'active' : 'onboarding',
        last_synced_at: new Date().toISOString(),
      })
      .eq('tenant_id', staff.tenantId)
      .eq('provider', 'stripe');

    revalidatePath('/integrations');
    return ok({ chargesEnabled });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Could not reach Stripe', {
      code: 'gateway',
    });
  }
}

const webhookSchema = z.object({
  orderWebhookUrl: z.string().url().max(2048).or(z.literal('')),
  posProvider: z.enum(['none', 'toast', 'square', 'clover']),
  posApiKey: z.string().max(512).optional(),
});

/**
 * Outbound order webhook and POS credentials.
 *
 * The webhook URL is live: `webhook_events` rows are enqueued in the same
 * transaction as the order and drained to this endpoint. The POS
 * credentials are stored durably but nothing syncs with them yet — see the
 * note rendered next to the field, which says so rather than implying a
 * connection that does not exist.
 */
export async function saveIntegrationSettings(
  input: z.infer<typeof webhookSchema>,
): Promise<ActionResult<void>> {
  const staff = await resolveStaffTenantId();
  if (!staff) return fail('You do not have access to this restaurant', { code: 'forbidden' });
  if (!staff.canManage) {
    return fail('Only the restaurant owner can change integrations', { code: 'forbidden' });
  }

  const parsed = webhookSchema.safeParse(input);
  if (!parsed.success) {
    return fail('Check the webhook URL', {
      code: 'validation',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    });
  }

  const service = createServiceClient();
  const entries: { key: string; value: string }[] = [];

  if (parsed.data.orderWebhookUrl) {
    entries.push({ key: 'ghl_webhook_url', value: parsed.data.orderWebhookUrl });
  }
  if (parsed.data.posProvider !== 'none' && parsed.data.posApiKey) {
    entries.push({ key: 'pos_provider', value: parsed.data.posProvider });
    entries.push({ key: 'pos_api_key', value: parsed.data.posApiKey });
  }

  for (const entry of entries) {
    const { error } = await service
      .from('tenant_secrets')
      .upsert({ tenant_id: staff.tenantId, ...entry }, { onConflict: 'tenant_id,key' });
    if (error) return fail(`Could not save ${entry.key}: ${error.message}`, { code: 'unknown' });
  }

  // An emptied URL means "stop sending", which is a delete, not a blank.
  if (!parsed.data.orderWebhookUrl) {
    await service
      .from('tenant_secrets')
      .delete()
      .eq('tenant_id', staff.tenantId)
      .eq('key', 'ghl_webhook_url');
  }

  revalidatePath('/integrations');
  return ok(undefined);
}
