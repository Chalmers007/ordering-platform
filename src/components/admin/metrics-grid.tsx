import { formatCents } from '@/lib/money';

type Metrics = {
  total_tenants: number;
  active_tenants: number;
  pending_tenants: number;
  suspended_tenants: number;
  past_due_tenants: number;
  gmv_cents: number;
  gmv_30d_cents: number;
  tech_fees_cents: number;
  tech_fees_30d_cents: number;
  orders_total: number;
  orders_30d: number;
  active_dispatch_jobs: number;
  open_kitchen_orders: number;
  paused_kitchens: number;
  platform_errors_24h: number;
};

function Card({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === 'warn' && value !== '0'
          ? 'border-amber-300 bg-amber-50'
          : 'border-neutral-200 bg-white'
      }`}
    >
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {sub ? <p className="mt-0.5 text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}

export function MetricsGrid({ metrics }: { metrics: Metrics }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Active restaurants"
        value={String(metrics.active_tenants)}
        sub={`${metrics.total_tenants} total · ${metrics.pending_tenants} pending · ${metrics.suspended_tenants} suspended`}
      />
      <Card
        label="GMV (30 days)"
        value={formatCents(metrics.gmv_30d_cents)}
        sub={`${formatCents(metrics.gmv_cents)} all time`}
      />
      <Card
        label="Tech fees (30 days)"
        value={formatCents(metrics.tech_fees_30d_cents)}
        sub={`${formatCents(metrics.tech_fees_cents)} all time`}
      />
      <Card
        label="Orders (30 days)"
        value={String(metrics.orders_30d)}
        sub={`${metrics.orders_total} all time`}
      />
      <Card label="Active dispatch jobs" value={String(metrics.active_dispatch_jobs)} />
      <Card label="Open kitchen orders" value={String(metrics.open_kitchen_orders)} />
      <Card label="Paused kitchens" value={String(metrics.paused_kitchens)} tone="warn" />
      <Card
        label="Errors (24 hours)"
        value={String(metrics.platform_errors_24h)}
        sub="Webhooks, payments, dispatch"
        tone="warn"
      />
    </dl>
  );
}
