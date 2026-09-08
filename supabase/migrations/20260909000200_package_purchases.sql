-- =====================================================================
-- 20260909000200_package_purchases.sql
-- Package purchase records for claim workflow
--
-- When a restaurant owner purchases a package during claim, a record is
-- created here. The Stripe webhook verifies payment and marks it confirmed.
-- Activation requires: payment confirmed + tenant claimed + menu verified.
-- =====================================================================

set lock_timeout = '5s';

create table if not exists public.package_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  -- Stripe payment_intent_id from webhook
  stripe_payment_intent_id text,
  -- Amount charged, in cents (must match package price_cents)
  amount_cents int not null check (amount_cents >= 0),
  -- Payment status: pending → confirmed (via webhook)
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'canceled')),
  -- When the restaurant completed the claim (after payment confirmed)
  claimed_at timestamptz,
  -- When the webhook was received and processed
  webhook_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for webhook lookup: quick idempotency check
create unique index if not exists package_purchases_stripe_payment_uq
  on public.package_purchases(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Index for checking payment before claim succeeds
create index if not exists package_purchases_tenant_status_idx
  on public.package_purchases(tenant_id, status)
  where status = 'confirmed';

-- Trigger for updated_at
drop trigger if exists package_purchases_updated_at on public.package_purchases;
create trigger package_purchases_updated_at
  before update on public.package_purchases
  for each row
  execute function public.fn_set_updated_at();

-- RLS: server-side only (never exposed to clients directly)
revoke all on public.package_purchases from public, anon, authenticated;

comment on table public.package_purchases is
  'Tracks restaurant package purchases during claim flow. '
  'Webhook verifies Stripe payment and marks confirmed. '
  'Activation requires: payment confirmed + claim completed + menu verified.';

comment on column public.package_purchases.status is
  'Payment status: pending (awaiting webhook) → confirmed (payment succeeded). '
  'failed/canceled if Stripe webhook indicates declined or canceled payment.';

comment on column public.package_purchases.claimed_at is
  'Set when claim_tenant() succeeds after payment confirmed.';

comment on column public.package_purchases.webhook_received_at is
  'Set when Stripe webhook processed this payment.';
