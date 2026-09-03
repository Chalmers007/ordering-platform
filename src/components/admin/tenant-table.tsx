'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money';
import type { SubscriptionStatus, Tenant, TenantStatus } from '@/types/database';

export type TenantRow = Tenant & {
  tenant_settings: {
    tech_fee_enabled: boolean;
    tech_fee_cents: number;
    is_kitchen_paused: boolean;
  } | null;
};

/**
 * The subscription vocabulary is the database's, not the mockup's: the
 * `subscription_status` enum has no "paused" — a restaurant that stops
 * trading is `suspended` at the tenant level, which is a different fact
 * from its billing state and is shown in its own column.
 */
const SUBSCRIPTION_FILTERS: { id: SubscriptionStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All billing' },
  { id: 'trialing', label: 'Trialing' },
  { id: 'active', label: 'Active' },
  { id: 'past_due', label: 'Past due' },
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'canceled', label: 'Canceled' },
];

const STATUS_FILTERS: { id: TenantStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<TenantStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-sky-100 text-sky-800',
  suspended: 'bg-amber-100 text-amber-900',
  cancelled: 'bg-neutral-200 text-neutral-700',
};

export function TenantTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TenantStatus | 'all'>('all');
  const [subscription, setSubscription] = useState<SubscriptionStatus | 'all'>('all');
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tenants.filter((tenant) => {
      if (status !== 'all' && tenant.status !== status) return false;
      if (subscription !== 'all' && tenant.subscription_status !== subscription) return false;
      if (!needle) return true;
      return (
        tenant.name.toLowerCase().includes(needle) ||
        tenant.slug.toLowerCase().includes(needle) ||
        (tenant.support_email ?? '').toLowerCase().includes(needle)
      );
    });
  }, [tenants, query, status, subscription]);

  async function impersonate(tenant: TenantRow) {
    setImpersonating(tenant.id);
    const response = await fetch('/api/admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: tenant.id, reason: 'Support from the platform console' }),
    });
    setImpersonating(null);

    const body = (await response.json().catch(() => null)) as
      | { error?: string; redirectTo?: string }
      | null;

    if (!response.ok) {
      toast.error(body?.error ?? 'Could not start impersonation');
      return;
    }

    // Cross-origin: admin.<root> -> app.<root>. router.push cannot leave the
    // origin, so this is a full navigation. The impersonation cookie is
    // scoped to the root domain, so it travels with it.
    if (body?.redirectTo) {
      window.location.assign(body.redirectTo);
      return;
    }
    router.refresh();
  }

  return (
    <section className="mt-6" aria-labelledby="tenants-heading">
      <h2 id="tenants-heading" className="text-lg font-semibold">
        Restaurants
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <Input
            type="search"
            className="pl-9"
            aria-label="Search restaurants"
            placeholder="Search by name, subdomain, or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <select
          aria-label="Filter by status"
          className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as TenantStatus | 'all')}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by subscription"
          className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
          value={subscription}
          onChange={(event) =>
            setSubscription(event.target.value as SubscriptionStatus | 'all')
          }
        >
          {SUBSCRIPTION_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-4 py-2.5">Restaurant</th>
              <th scope="col" className="px-4 py-2.5">Status</th>
              <th scope="col" className="px-4 py-2.5">Billing</th>
              <th scope="col" className="px-4 py-2.5">Tech fee</th>
              <th scope="col" className="px-4 py-2.5">Kitchen</th>
              <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-neutral-500">
                  No restaurants match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{tenant.name}</p>
                    <p className="text-xs text-neutral-500">{tenant.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[tenant.status]}`}
                    >
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        ['past_due', 'unpaid'].includes(tenant.subscription_status)
                          ? 'font-medium text-red-700'
                          : 'text-neutral-700'
                      }
                    >
                      {tenant.subscription_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {tenant.tenant_settings?.tech_fee_enabled ? (
                      <span className="text-neutral-900">
                        {formatCents(tenant.tenant_settings.tech_fee_cents, tenant.currency)}
                      </span>
                    ) : (
                      <span className="text-neutral-400">Off</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {tenant.tenant_settings?.is_kitchen_paused ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                        Paused
                      </span>
                    ) : (
                      <span className="text-neutral-500">Running</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      loading={impersonating === tenant.id}
                      onClick={() => impersonate(tenant)}
                    >
                      <LogIn className="h-3.5 w-3.5" aria-hidden />
                      Log in as
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        Showing {filtered.length} of {tenants.length} restaurants.
      </p>
    </section>
  );
}
