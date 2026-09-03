-- ---------------------------------------------------------------------
-- Drop the stale record_dispatch_reference() overloads.
--
-- `create or replace function` replaces a function only when the argument
-- types match exactly. Two migrations extended this function by adding
-- parameters, so each one created a NEW overload and left the previous
-- version in place. Three now exist:
--
--   (uuid, text, delivery_status, timestamptz, timestamptz)
--   (uuid, text, delivery_status, timestamptz, timestamptz, text)
--   (uuid, text, delivery_status, timestamptz, timestamptz, text, text, text, text)
--
-- Because every added parameter has a default, a caller supplying only the
-- first few arguments matches all three, and Postgres refuses:
--
--   ERROR: function public.record_dispatch_reference(uuid, unknown, unknown)
--          is not unique
--
-- The application escapes this by calling with named parameters unique to
-- the newest signature, which is why the failure surfaced in a SQL test
-- rather than in production. That is luck, not design: any caller that
-- omits `p_provider` — a future one, or a psql session during an incident
-- — hits an error whose message points at the call site rather than at the
-- duplicate definitions.
--
-- Only the newest signature is kept. The older ones are unreachable by
-- name and cannot be reached deliberately.
-- ---------------------------------------------------------------------

drop function if exists public.record_dispatch_reference(
  uuid, text, public.delivery_status, timestamptz, timestamptz
);

drop function if exists public.record_dispatch_reference(
  uuid, text, public.delivery_status, timestamptz, timestamptz, text
);

-- Guard the bug class rather than this one instance: if a future migration
-- extends this function again by adding a parameter, the leftover overload
-- fails the deploy here instead of surfacing as an ambiguous-call error
-- somewhere unrelated later.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_dispatch_reference';

  if v_count <> 1 then
    raise exception
      'record_dispatch_reference has % overloads, expected exactly 1. Adding a parameter creates a new function rather than replacing the old one; drop the previous signature in the same migration.',
      v_count;
  end if;
end $$;
