-- =====================================================================
-- 20260902090000_core_tenancy.sql
-- Platform core: tenancy, domains, settings, secrets, identities,
-- payment gateway connections.
--
-- Money is ALWAYS stored as integer cents. Never float, never numeric-
-- with-rounding-at-render.
-- =====================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------
create type public.tenant_status as enum (
  'pending',      -- created, not yet onboarded
  'active',       -- storefront live
  'suspended',    -- billing failure / policy hold; storefront returns 503
  'cancelled'     -- churned; storefront offline, data retained
);

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid'
);

create type public.user_role as enum (
  'super_admin',   -- platform operator; cross-tenant
  'tenant_owner',  -- restaurant owner; full control of one tenant
  'tenant_staff',  -- kitchen / counter staff; operational subset
  'customer'       -- storefront diner
);

create type public.payment_provider as enum ('stripe', 'square', 'paypal');

create type public.gateway_account_status as enum (
  'pending', 'onboarding', 'active', 'restricted', 'disconnected'
);

-- ---------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.fn_set_updated_at() is
  'BEFORE UPDATE trigger: maintains updated_at. Attach to every mutable table.';

-- ---------------------------------------------------------------------
-- reserved_subdomains
-- Single source of truth for slugs a tenant may not claim. The routing
-- surfaces (admin/app) live here too so a tenant can never shadow them.
-- ---------------------------------------------------------------------
create table public.reserved_subdomains (
  slug   text primary key,
  reason text not null
);

insert into public.reserved_subdomains (slug, reason) values
  ('admin',   'platform super-admin surface'),
  ('app',     'tenant staff dashboard surface'),
  ('www',     'marketing site'),
  ('api',     'platform api'),
  ('cdn',     'asset delivery'),
  ('assets',  'asset delivery'),
  ('static',  'asset delivery'),
  ('mail',    'infrastructure'),
  ('smtp',    'infrastructure'),
  ('ftp',     'infrastructure'),
  ('ns1',     'infrastructure'),
  ('ns2',     'infrastructure'),
  ('status',  'infrastructure'),
  ('docs',    'platform documentation'),
  ('support', 'platform support'),
  ('billing', 'platform billing'),
  ('dashboard','reserved for future platform surface'),
  ('kds',     'reserved for future platform surface'),
  ('orders',  'ambiguous with customer custom domains'),
  ('order',   'ambiguous with customer custom domains');

-- ---------------------------------------------------------------------
-- tenants
-- One row per restaurant brand. Everything else in the platform hangs
-- off this id with ON DELETE CASCADE.
-- ---------------------------------------------------------------------
create table public.tenants (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  name                 text not null,
  legal_name           text,
  support_email        text,
  support_phone        text,
  status               public.tenant_status not null default 'pending',
  timezone             text not null default 'America/New_York',
  currency             char(3) not null default 'USD',
  locale               text not null default 'en-US',

  -- SaaS billing (platform -> tenant), distinct from order payments.
  subscription_status  public.subscription_status not null default 'trialing',
  stripe_customer_id   text unique,
  stripe_subscription_id text unique,
  trial_ends_at        timestamptz,

  onboarded_at         timestamptz,
  suspended_at         timestamptz,
  suspended_reason     text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint tenants_slug_format_chk
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'),
  constraint tenants_currency_chk
    check (currency ~ '^[A-Z]{3}$'),
  constraint tenants_suspension_chk
    check (status <> 'suspended' or suspended_at is not null)
);

create index tenants_status_idx on public.tenants (status);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.fn_set_updated_at();

-- Slug normalisation + reserved-word enforcement in one place.
create or replace function public.fn_tenants_normalize_slug()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.slug := lower(trim(new.slug));

  if exists (select 1 from public.reserved_subdomains r where r.slug = new.slug) then
    raise exception 'Subdomain "%" is reserved by the platform', new.slug
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger tenants_normalize_slug
  before insert or update of slug on public.tenants
  for each row execute function public.fn_tenants_normalize_slug();

-- ---------------------------------------------------------------------
-- tenant_domains
-- Custom hostnames (orders.joespizza.com). Read by the edge middleware
-- on every request, so it is deliberately small and index-covered.
-- ---------------------------------------------------------------------
create table public.tenant_domains (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  hostname            text not null,
  is_primary          boolean not null default false,
  verification_token  text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at         timestamptz,
  ssl_issued_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint tenant_domains_hostname_format_chk
    check (hostname ~ '^[a-z0-9]([a-z0-9.-]{1,251}[a-z0-9])?$' and hostname like '%.%')
);

create unique index tenant_domains_hostname_key on public.tenant_domains (hostname);
create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id);
-- At most one primary domain per tenant.
create unique index tenant_domains_one_primary_idx
  on public.tenant_domains (tenant_id) where is_primary;

create trigger tenant_domains_set_updated_at
  before update on public.tenant_domains
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_tenant_domains_normalize()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.hostname := lower(trim(new.hostname));
  -- Tolerate operators pasting a full URL.
  new.hostname := regexp_replace(new.hostname, '^https?://', '');
  new.hostname := split_part(new.hostname, '/', 1);
  new.hostname := split_part(new.hostname, ':', 1);
  return new;
end;
$$;

create trigger tenant_domains_normalize
  before insert or update of hostname on public.tenant_domains
  for each row execute function public.fn_tenant_domains_normalize();

-- ---------------------------------------------------------------------
-- tenant_settings
-- 1:1 with tenant. Operationally public: the storefront and the KDS both
-- read it live. Nothing secret is allowed in this table -- secrets go to
-- tenant_secrets, which no browser role can read.
-- ---------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id                 uuid primary key references public.tenants(id) on delete cascade,

  -- Branding (white label)
  logo_url                  text,
  cover_image_url           text,
  brand_primary_color       text not null default '#111827',
  brand_accent_color        text not null default '#f97316',
  tagline                   text,
  description               text,

  -- Platform tech fee ($1.00 flat, split to the platform account)
  tech_fee_enabled          boolean not null default false,
  tech_fee_cents            integer not null default 100,

  -- Kitchen controls (KDS)
  is_kitchen_paused         boolean not null default false,
  kitchen_paused_at         timestamptz,
  kitchen_paused_reason     text,
  estimated_prep_time_mins  integer not null default 20,

  -- Fulfilment
  accepts_delivery          boolean not null default true,
  accepts_pickup            boolean not null default true,
  delivery_fee_cents        integer not null default 0,
  delivery_minimum_cents    integer not null default 0,
  delivery_radius_meters    integer not null default 8000,
  service_fee_bps           integer not null default 0,   -- basis points of subtotal
  tax_rate_bps              integer not null default 0,    -- basis points, e.g. 875 = 8.75%
  default_tip_bps           integer not null default 1500,

  -- Address / geocode used as the dispatch pickup point
  address_line1             text,
  address_line2             text,
  city                      text,
  region                    text,
  postal_code               text,
  country                   char(2) not null default 'US',
  latitude                  double precision,
  longitude                 double precision,

  -- Opening hours: [{ dow:0-6, open:"11:00", close:"22:00" }]
  business_hours            jsonb not null default '[]'::jsonb,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint tenant_settings_tech_fee_chk        check (tech_fee_cents between 0 and 1000),
  constraint tenant_settings_prep_time_chk       check (estimated_prep_time_mins between 0 and 240),
  constraint tenant_settings_delivery_fee_chk    check (delivery_fee_cents >= 0),
  constraint tenant_settings_delivery_min_chk    check (delivery_minimum_cents >= 0),
  constraint tenant_settings_radius_chk          check (delivery_radius_meters between 0 and 80000),
  constraint tenant_settings_service_fee_chk     check (service_fee_bps between 0 and 5000),
  constraint tenant_settings_tax_rate_chk        check (tax_rate_bps between 0 and 5000),
  constraint tenant_settings_tip_chk             check (default_tip_bps between 0 and 10000),
  constraint tenant_settings_fulfilment_chk      check (accepts_delivery or accepts_pickup),
  constraint tenant_settings_pause_chk
    check (is_kitchen_paused = false or kitchen_paused_at is not null),
  constraint tenant_settings_hours_chk           check (jsonb_typeof(business_hours) = 'array')
);

create trigger tenant_settings_set_updated_at
  before update on public.tenant_settings
  for each row execute function public.fn_set_updated_at();

-- Keep kitchen_paused_at honest without asking the client to send it.
create or replace function public.fn_tenant_settings_pause_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.is_kitchen_paused and not coalesce(old.is_kitchen_paused, false) then
    new.kitchen_paused_at := now();
  elsif not new.is_kitchen_paused then
    new.kitchen_paused_at := null;
    new.kitchen_paused_reason := null;
  end if;
  return new;
end;
$$;

create trigger tenant_settings_pause_stamp
  before insert or update of is_kitchen_paused on public.tenant_settings
  for each row execute function public.fn_tenant_settings_pause_stamp();

-- Every tenant gets a settings row the moment it exists. No "null settings"
-- branch anywhere in application code.
create or replace function public.fn_tenants_bootstrap_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tenant_settings (tenant_id) values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger tenants_bootstrap_settings
  after insert on public.tenants
  for each row execute function public.fn_tenants_bootstrap_settings();

-- ---------------------------------------------------------------------
-- tenant_secrets
-- Shipday API keys, Square OAuth tokens, PayPal secrets, GHL webhook
-- URLs. RLS is enabled with ZERO policies: only service_role (Edge
-- Functions / server-only code) can ever read this table.
-- ---------------------------------------------------------------------
create table public.tenant_secrets (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null,
  value       text not null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key),
  constraint tenant_secrets_key_chk check (key = lower(key) and key ~ '^[a-z0-9_]{3,64}$')
);

comment on table public.tenant_secrets is
  'Service-role only. RLS enabled with no policies by design - never expose to anon/authenticated.';

create trigger tenant_secrets_set_updated_at
  before update on public.tenant_secrets
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- user_profiles
-- Mirrors auth.users with platform role + tenant binding.
--
-- tenant_id is intentionally NULLABLE for non-super-admins: a signup that
-- arrives without tenant metadata must still produce a profile row. A
-- profile with a null tenant simply sees nothing, which is visible and
-- repairable. The alternative -- a hard constraint that aborts the
-- auth.users trigger -- produces authenticated users with no profile at
-- all, which is the classic "logs in, then bounces forever" failure.
-- ---------------------------------------------------------------------
create table public.user_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid references public.tenants(id) on delete cascade,
  role          public.user_role not null default 'customer',
  full_name     text,
  email         text,
  phone         text,
  avatar_url    text,
  marketing_opt_in boolean not null default false,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A super admin is platform-scoped and must never be bound to a tenant.
  constraint user_profiles_super_admin_scope_chk
    check (role <> 'super_admin' or tenant_id is null)
);

create index user_profiles_tenant_role_idx on public.user_profiles (tenant_id, role);
create index user_profiles_phone_idx on public.user_profiles (tenant_id, phone) where phone is not null;

create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.fn_set_updated_at();

-- Auth signup -> profile. Tenant + role are read from the signup metadata
-- the storefront/staff invite flow supplies.
create or replace function public.fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_role      public.user_role;
begin
  begin
    v_tenant_id := nullif(new.raw_user_meta_data ->> 'tenant_id', '')::uuid;
  exception when others then
    v_tenant_id := null;
  end;

  begin
    v_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'customer')::public.user_role;
  exception when others then
    v_role := 'customer';
  end;

  -- Role escalation can never come from client-supplied signup metadata.
  if v_role in ('super_admin', 'tenant_owner') then
    v_role := 'customer';
  end if;

  if v_role = 'super_admin' then
    v_tenant_id := null;
  end if;

  insert into public.user_profiles (id, tenant_id, role, full_name, email, phone)
  values (
    new.id,
    v_tenant_id,
    v_role,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.phone
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_auth_user();

-- ---------------------------------------------------------------------
-- payment_gateway_accounts
-- Per-tenant connected accounts. Only non-secret identifiers live here;
-- OAuth tokens live in tenant_secrets.
-- ---------------------------------------------------------------------
create table public.payment_gateway_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  provider              public.payment_provider not null,
  status                public.gateway_account_status not null default 'pending',
  is_default            boolean not null default false,

  -- Stripe: acct_...; Square: merchant id; PayPal: merchant id
  external_account_id   text,
  -- Stripe Connect capability flags, mirrored from webhooks
  charges_enabled       boolean not null default false,
  payouts_enabled       boolean not null default false,
  details_submitted     boolean not null default false,
  -- Stripe: 'express' | 'custom' | 'standard'
  account_type          text,
  livemode              boolean not null default false,
  last_synced_at        timestamptz,
  disconnect_reason     text,
  metadata              jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint payment_gateway_accounts_metadata_chk
    check (jsonb_typeof(metadata) = 'object')
);

create unique index payment_gateway_accounts_tenant_provider_key
  on public.payment_gateway_accounts (tenant_id, provider);
create unique index payment_gateway_accounts_one_default_idx
  on public.payment_gateway_accounts (tenant_id) where is_default;
create unique index payment_gateway_accounts_external_key
  on public.payment_gateway_accounts (provider, external_account_id)
  where external_account_id is not null;

create trigger payment_gateway_accounts_set_updated_at
  before update on public.payment_gateway_accounts
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- impersonation_sessions
-- Super-admin "view as tenant". The session row is what drives the
-- persistent banner in the UI and the audit trail of who looked at what.
-- ---------------------------------------------------------------------
create table public.impersonation_sessions (
  id             uuid primary key default gen_random_uuid(),
  super_admin_id uuid not null references auth.users(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  reason         text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);

create index impersonation_sessions_admin_idx
  on public.impersonation_sessions (super_admin_id, started_at desc);
create unique index impersonation_sessions_one_active_idx
  on public.impersonation_sessions (super_admin_id) where ended_at is null;
