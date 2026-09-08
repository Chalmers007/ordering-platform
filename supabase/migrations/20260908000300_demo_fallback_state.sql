-- =====================================================================
-- 20260908000300_demo_fallback_state.sql
-- Demo fallback state tracking for restaurants without automatic provisioning
--
-- When Raven scraping fails or is unavailable, restaurants can still view
-- a demo storefront using their discovered name, optional logo, and optional
-- menu. This table tracks the fallback state and progress toward claiming
-- and activation.
--
-- One fallback per prospect: raven_prospect_id is unique. If Raven later
-- attempts the same prospect, it reuses the existing fallback tenant.
-- =====================================================================

set lock_timeout = '5s';

create table if not exists public.demo_fallback_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  -- Raven prospect this fallback was created for, if any. Null if created manually.
  raven_prospect_id uuid unique,
  -- State machine: one prospect cannot have multiple active fallback records
  state text not null default 'created' check (state in (
    'created',
    'awaiting_logo',
    'awaiting_menu',
    'preview_ready',
    'claimed',
    'activated'
  )),
  -- When logo was last uploaded
  logo_uploaded_at timestamptz,
  -- When menu was last uploaded (by restaurant)
  menu_uploaded_at timestamptz,
  -- When menu was verified as accurate (by operator)
  menu_verified_at timestamptz,
  -- When owner claimed the storefront
  claimed_at timestamptz,
  -- When storefront was activated for live ordering
  activated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for finding fallback by Raven prospect
create unique index if not exists demo_fallback_raven_prospect_uq
  on public.demo_fallback_state(raven_prospect_id)
  where raven_prospect_id is not null;

-- Index for finding fallback by tenant (already unique, but explicit for query plans)
create index if not exists demo_fallback_tenant_idx
  on public.demo_fallback_state(tenant_id);

-- Trigger for updated_at
drop trigger if exists demo_fallback_state_updated_at on public.demo_fallback_state;
create trigger demo_fallback_state_updated_at
  before update on public.demo_fallback_state
  for each row
  execute function public.fn_set_updated_at();

-- RLS: demo fallback state is server-side only, never exposed to clients
revoke all on public.demo_fallback_state from public, anon, authenticated;

comment on table public.demo_fallback_state is
  'Tracks fallback demo storefront state for restaurants without automatic provisioning. '
  'Separate from raven_provisioning_requests to isolate fallback-initiated workflows.';

comment on column public.demo_fallback_state.raven_prospect_id is
  'Raven prospect this fallback serves. Null if created outside Raven workflow. '
  'Unique so multiple provisioning attempts for same prospect reuse the same tenant.';

comment on column public.demo_fallback_state.state is
  'Fallback state machine: created → awaiting_logo (if no logo yet) → awaiting_menu (if no menu yet) '
  '→ preview_ready → claimed → activated. Logo and menu are optional; can skip awaiting_* states.';

comment on column public.demo_fallback_state.menu_verified_at is
  'When operator confirmed menu is accurate. Set only after owner claims and operator reviews pricing.';
