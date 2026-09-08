-- =====================================================================
-- 20260908000400_demo_builder_name_hash.sql
-- Add name_hash to demo_fallback_state for field-sales deduplication
--
-- Field sales teams need to create demos by restaurant name. Adding a name_hash
-- allows idempotent demo creation: submit the same restaurant name, get the same
-- demo back. This avoids duplicate tenants for the same prospect.
-- =====================================================================

set lock_timeout = '5s';

alter table public.demo_fallback_state
  add column if not exists name_hash text;

-- Index for finding fallback by name hash
create unique index if not exists demo_fallback_name_hash_uq
  on public.demo_fallback_state(name_hash)
  where name_hash is not null;

comment on column public.demo_fallback_state.name_hash is
  'SHA-256 hash of (trimmed lowercase) restaurant name for deduplication in field sales workflow. '
  'Allows idempotent demo creation: same name always returns same demo.';
