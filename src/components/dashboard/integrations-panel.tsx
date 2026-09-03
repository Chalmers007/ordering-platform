'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, CircleAlert, CreditCard, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  refreshStripeStatus,
  saveIntegrationSettings,
  startStripeOnboarding,
} from '@/app/(kds)/app/(dashboard)/integrations/actions';

const inputClass =
  'border-neutral-700 bg-neutral-950 text-neutral-100 placeholder:text-neutral-600 disabled:opacity-50';

type StripeState = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  status: string | null;
};

export function IntegrationsPanel({
  canManage,
  stripe,
  hasOrderWebhook,
  hasPosCredentials,
  stripeConfigured,
}: {
  canManage: boolean;
  stripe: StripeState;
  hasOrderWebhook: boolean;
  hasPosCredentials: boolean;
  stripeConfigured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [posProvider, setPosProvider] = useState<'none' | 'toast' | 'square' | 'clover'>('none');
  const [posApiKey, setPosApiKey] = useState('');

  function connect() {
    startTransition(async () => {
      const result = await startStripeOnboarding();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Stripe hosts onboarding, so this leaves the app entirely.
      window.location.assign(result.data.url);
    });
  }

  function refresh() {
    startTransition(async () => {
      const result = await refreshStripeStatus();
      if (result.ok) {
        toast.success(
          result.data.chargesEnabled
            ? 'Stripe account is live and can take payments'
            : 'Stripe is still verifying this account',
        );
      } else toast.error(result.error);
    });
  }

  function saveWebhooks() {
    startTransition(async () => {
      const result = await saveIntegrationSettings({
        orderWebhookUrl: webhookUrl.trim(),
        posProvider,
        posApiKey: posApiKey.trim() || undefined,
      });
      if (result.ok) {
        toast.success('Integration settings saved');
        setPosApiKey('');
      } else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-4 pb-16">
      {/* ---- Stripe ---- */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 h-5 w-5 text-neutral-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-neutral-100">Stripe Connect</h2>
            <p className="mt-0.5 text-sm text-neutral-400">
              Customers pay you directly. The platform takes only its technology fee from each
              order; the rest settles to your own Stripe account.
            </p>

            <div className="mt-3">
              {!stripeConfigured ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Stripe is not configured on this deployment yet. Connecting will not work until
                  the platform sets its Stripe keys.
                </p>
              ) : stripe.chargesEnabled ? (
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Connected and taking payments
                </p>
              ) : stripe.connected ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {stripe.detailsSubmitted
                    ? 'Stripe is verifying your details. This usually takes a few minutes.'
                    : 'Onboarding started but not finished — continue to accept payments.'}
                </p>
              ) : (
                <p className="text-sm text-neutral-400">Not connected. Checkout is disabled.</p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button loading={pending} disabled={!canManage} onClick={connect}>
                {stripe.connected ? 'Continue Stripe onboarding' : 'Connect with Stripe'}
              </Button>
              {stripe.connected ? (
                <Button variant="outline" loading={pending} disabled={!canManage} onClick={refresh}>
                  Refresh status
                </Button>
              ) : null}
            </div>

            {!canManage ? (
              <p className="mt-2 text-xs text-neutral-500">
                Only the restaurant owner can connect a payment account.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---- Order webhook ---- */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-start gap-3">
          <Webhook className="mt-0.5 h-5 w-5 text-neutral-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-neutral-100">Order webhook</h2>
            <p className="mt-0.5 text-sm text-neutral-400">
              Every order is POSTed here when it is placed and when a first-time customer
              orders. Works with GoHighLevel, Zapier, Make, or any endpoint you control.
            </p>

            <label className="mt-3 block">
              <span className="mb-1 block text-sm text-neutral-300">
                Endpoint URL
                {hasOrderWebhook ? (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">
                    configured
                  </span>
                ) : null}
              </span>
              <Input
                className={inputClass}
                value={webhookUrl}
                disabled={!canManage}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder={hasOrderWebhook ? 'Enter a new URL to replace the current one' : 'https://…'}
              />
            </label>
            <p className="mt-1.5 text-xs text-neutral-500">
              The stored URL is never shown back — it is a secret. Leave blank and save to stop
              sending. Deliveries retry with exponential backoff.
            </p>
          </div>
        </div>
      </section>

      {/* ---- POS ---- */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="font-semibold text-neutral-100">Point of sale</h2>
        <p className="mt-0.5 text-sm text-neutral-400">
          Store credentials for your POS so they are ready when sync ships.
        </p>

        <p className="mt-3 flex items-start gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
          <span>
            <strong className="font-medium">Sync is not live yet.</strong> Credentials saved here
            are stored securely but nothing reads them — no orders are pushed to your POS today.
            Use the order webhook above for a working integration.
          </span>
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-300">Provider</span>
            <select
              className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 disabled:opacity-50"
              value={posProvider}
              disabled={!canManage}
              onChange={(event) =>
                setPosProvider(event.target.value as 'none' | 'toast' | 'square' | 'clover')
              }
            >
              <option value="none">Not connected</option>
              <option value="toast">Toast</option>
              <option value="square">Square</option>
              <option value="clover">Clover</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-neutral-300">
              API key
              {hasPosCredentials ? (
                <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">
                  stored
                </span>
              ) : null}
            </span>
            <Input
              className={inputClass}
              type="password"
              value={posApiKey}
              disabled={!canManage || posProvider === 'none'}
              onChange={(event) => setPosApiKey(event.target.value)}
              placeholder="••••••••"
            />
          </label>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        <Button size="lg" loading={pending} disabled={!canManage} onClick={saveWebhooks} className="w-full sm:w-auto">
          Save integrations
        </Button>
      </div>
    </div>
  );
}
