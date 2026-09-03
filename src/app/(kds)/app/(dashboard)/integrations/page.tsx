import { notFound } from 'next/navigation';
import { createClientForRequest, createServiceClient } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { IntegrationsPanel } from '@/components/dashboard/integrations-panel';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const staff = await resolveStaffTenantId();
  if (!staff) notFound();

  const supabase = await createClientForRequest();
  const { data: gateway } = await supabase
    .from('payment_gateway_accounts')
    .select('status, charges_enabled, payouts_enabled, details_submitted, external_account_id')
    .eq('tenant_id', staff.tenantId)
    .eq('provider', 'stripe')
    .maybeSingle();

  // Secrets are never sent to the browser — only whether one is set, so the
  // form can say "configured" without handing the value back.
  const service = createServiceClient();
  const { data: secrets } = await service
    .from('tenant_secrets')
    .select('key')
    .eq('tenant_id', staff.tenantId);

  const keys = new Set((secrets ?? []).map((s) => s.key));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold text-neutral-100">Integrations & POS</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Payments, order notifications, and point-of-sale.
      </p>

      <div className="mt-5">
        <IntegrationsPanel
          canManage={staff.canManage}
          stripe={{
            connected: Boolean(gateway?.external_account_id),
            chargesEnabled: Boolean(gateway?.charges_enabled),
            payoutsEnabled: Boolean(gateway?.payouts_enabled),
            detailsSubmitted: Boolean(gateway?.details_submitted),
            status: gateway?.status ?? null,
          }}
          hasOrderWebhook={keys.has('ghl_webhook_url')}
          hasPosCredentials={keys.has('pos_api_key')}
          stripeConfigured={Boolean(process.env.STRIPE_SECRET_KEY)}
        />
      </div>
    </main>
  );
}
