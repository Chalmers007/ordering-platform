-- =====================================================================
-- 20260904001500_dispatch_event_log.sql
-- Immutable event log for dispatch lifecycle visibility.
-- =====================================================================

create table if not exists public.dispatch_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  event_type text not null,
  status text,
  external_ref text,
  provider text,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dispatch_events_tenant_id_idx on public.dispatch_events(tenant_id);
create index if not exists dispatch_events_order_id_idx on public.dispatch_events(order_id);
create index if not exists dispatch_events_delivery_id_idx on public.dispatch_events(delivery_id);
create index if not exists dispatch_events_created_at_idx on public.dispatch_events(created_at desc);

-- RLS: staff can read their own tenant's events.
--
-- This originally selected from `public.staff_members`, which does not
-- exist in this schema — the migration could never have applied. Staff
-- membership is `user_profiles`, reached through the SECURITY DEFINER
-- helper `has_tenant_access()` that every other tenant-scoped policy uses
-- (a direct subselect would re-enter user_profiles' own policies).
alter table public.dispatch_events enable row level security;

-- A table created after 20260902090400_security.sql inherits Supabase's
-- default anon/authenticated grants, which that migration's blanket
-- revoke does not reach. Revoke first, then grant back only the read the
-- policy below is meant to allow.
revoke all on public.dispatch_events from anon, authenticated;
grant select on public.dispatch_events to authenticated;

create policy "staff read own tenant dispatch events" on public.dispatch_events
  for select
  using (public.has_tenant_access(tenant_id));

comment on table public.dispatch_events is
  'Immutable log of dispatch lifecycle events for audit and debugging.';

comment on column public.dispatch_events.event_type is
  'Event: dispatch_created, dispatch_queued, dispatch_succeeded, dispatch_failed, dispatch_retried, delivery_status_updated, delivery_cancelled';

comment on column public.dispatch_events.status is
  'Delivery status at time of event (assigned, picked_up, en_route, delivered, etc.)';

comment on column public.dispatch_events.external_ref is
  'Uber delivery ID or external reference from courier';

comment on column public.dispatch_events.error_message is
  'Error message if event_type=dispatch_failed';

comment on column public.dispatch_events.metadata is
  'JSON context: quote_fee_cents, retry_attempt, backoff_seconds, etc.';
