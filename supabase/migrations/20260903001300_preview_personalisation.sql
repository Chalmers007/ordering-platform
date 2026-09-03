-- =====================================================================
-- 20260903001300_preview_personalisation.sql
-- Letting a restaurant put its own logo on a preview before it claims it.
--
-- ── The shape of the problem ─────────────────────────────────────────
-- The whole point is that nobody signs in. A prospect follows a link,
-- sees their menu, and should be able to drop their logo on it without
-- an account, an email or a card. That means an upload endpoint reachable
-- by anyone who knows a storefront URL, which is not a thing to add
-- casually.
--
-- What keeps it safe:
--
--   * uploads land in a SESSION, not on the tenant. Nothing here can
--     modify a real storefront — the transfer happens once, at claim,
--     and only for a claim that succeeded.
--   * the session is addressed by a random 256-bit token held in an
--     httpOnly cookie. Only the hash is stored, so the table cannot be
--     read to take over somebody's session. That is what stops a second
--     visitor changing the first one's images while both can still view
--     the preview.
--   * the bucket is PRIVATE. Files are served by a route that checks the
--     cookie, so an anonymous upload endpoint cannot be used to host
--     arbitrary content on our domain.
--   * sessions expire, and expired ones are deleted with their files.
--
-- Supabase's default privileges grant new tables to anon and
-- authenticated, so both are revoked explicitly below. Everything here is
-- reached through the service role in a server action.
-- =====================================================================

set lock_timeout = '5s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preview-uploads', 'preview-uploads', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No object policies at all: this bucket is private and every read and
-- write goes through the service role behind a cookie check. A policy
-- here would be a second, weaker door.

-- ---------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------
create table if not exists public.preview_sessions (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  -- SHA-256 of the cookie value. The raw token never touches this table,
  -- for the same reason a password hash is stored instead of a password.
  token_hash   text        not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  -- Set when a claim moved these files onto the tenant. A session is
  -- transferred exactly once.
  transferred_at timestamptz
);

create index if not exists preview_sessions_tenant_idx on public.preview_sessions (tenant_id);
create index if not exists preview_sessions_expiry_idx on public.preview_sessions (expires_at) where transferred_at is null;

comment on table public.preview_sessions is
  'An anonymous visitor personalising an unclaimed storefront. Addressed by a hashed token held in an httpOnly cookie; never grants any access to the tenant itself.';

-- ---------------------------------------------------------------------
-- Uploaded files
-- ---------------------------------------------------------------------
create table if not exists public.preview_session_assets (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references public.preview_sessions(id) on delete cascade,
  kind         text        not null,
  storage_path text        not null,
  mime_type    text        not null,
  bytes        integer     not null,
  created_at   timestamptz not null default now()
);

do $$ begin
  alter table public.preview_session_assets add constraint preview_session_assets_kind_chk
    check (kind in ('logo', 'banner', 'item'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.preview_session_assets add constraint preview_session_assets_mime_chk
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.preview_session_assets add constraint preview_session_assets_bytes_chk
    check (bytes > 0 and bytes <= 5242880);
exception when duplicate_object then null; end $$;

-- One logo and one banner per session; replacing means overwriting the row,
-- not accumulating orphans.
create unique index if not exists preview_session_assets_single_idx
  on public.preview_session_assets (session_id, kind)
  where kind in ('logo', 'banner');

create index if not exists preview_session_assets_session_idx on public.preview_session_assets (session_id);

-- ---------------------------------------------------------------------
-- Lock both tables down
-- ---------------------------------------------------------------------
alter table public.preview_sessions enable row level security;
alter table public.preview_session_assets enable row level security;

-- No policies are created deliberately: with RLS on and no policy, every
-- role except the service role sees nothing. The grants are revoked too,
-- because Supabase's default privileges hand new tables to anon.
revoke all on public.preview_sessions from anon, authenticated;
revoke all on public.preview_session_assets from anon, authenticated;

-- ---------------------------------------------------------------------
-- Cleanup
--
-- An abandoned preview is the normal case, not the exception: most people
-- who look will not claim. Expired sessions are deleted here and their
-- files removed by the caller, which knows how to talk to storage.
-- ---------------------------------------------------------------------
create or replace function public.expired_preview_sessions(p_limit integer default 200)
returns table (id uuid, storage_paths text[])
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.id,
         coalesce(array_agg(a.storage_path) filter (where a.storage_path is not null), '{}')
  from public.preview_sessions s
  left join public.preview_session_assets a on a.session_id = s.id
  where s.expires_at < now()
    and s.transferred_at is null
  group by s.id
  limit greatest(1, p_limit);
$$;

revoke all on function public.expired_preview_sessions(integer) from public, anon, authenticated;

comment on function public.expired_preview_sessions is
  'Sessions past their expiry that were never claimed, with the files to delete. Returns nothing for a transferred session — those files now belong to the tenant.';
