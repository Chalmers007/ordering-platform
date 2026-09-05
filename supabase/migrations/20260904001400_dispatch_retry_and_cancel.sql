-- =====================================================================
-- 20260904001400_dispatch_retry_and_cancel.sql
-- Add retry logic and cancellation support to deliveries.
-- =====================================================================

-- Retry tracking: how many times we've tried to dispatch
alter table public.deliveries
  add column if not exists attempts integer default 0;

-- Next time we should retry this delivery (backoff schedule)
alter table public.deliveries
  add column if not exists next_retry_at timestamptz default now();

-- When this delivery was cancelled by customer
alter table public.deliveries
  add column if not exists cancelled_at timestamptz;

comment on column public.deliveries.attempts is
  'Number of dispatch attempts. Exponential backoff: 30s, 5m, 30m, 4h, 24h';

comment on column public.deliveries.next_retry_at is
  'Scheduled time for next dispatch retry if unassigned';

comment on column public.deliveries.cancelled_at is
  'When customer cancelled this delivery';
