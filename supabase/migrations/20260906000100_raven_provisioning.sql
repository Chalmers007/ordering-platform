create table if not exists public.raven_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system = 'raven'),
  raven_prospect_id uuid not null,
  google_place_id text,
  normalized_business_name text not null,
  normalized_address text not null,
  normalized_website text,
  phone text, email text, restaurant_category text not null,
  menu_source_url text not null, menu_content_type text not null,
  menu_content_sha256 text not null check (menu_content_sha256 ~ '^[0-9a-fA-F]{64}$'),
  menu_fetched_at timestamptz not null,
  idempotency_key text not null, event_type text not null, occurred_at timestamptz not null,
  source_payload_hash text not null check (source_payload_hash ~ '^[0-9a-fA-F]{64}$'),
  provisioning_status text not null default 'processing' check (provisioning_status in ('processing','succeeded','failed','exhausted')),
  tenant_id uuid references public.tenants(id) on delete set null,
  preview_id uuid, claim_url text, preview_url text, expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0), next_retry_at timestamptz,
  last_error text, error_code text, retryable boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists raven_provision_source_prospect_uq on public.raven_provisioning_requests(source_system, raven_prospect_id);
create unique index if not exists raven_provision_idempotency_uq on public.raven_provisioning_requests(source_system, idempotency_key);
create unique index if not exists raven_provision_place_uq on public.raven_provisioning_requests(source_system, google_place_id) where google_place_id is not null;
create unique index if not exists raven_provision_identity_uq on public.raven_provisioning_requests(source_system, normalized_business_name, normalized_address);
create table if not exists public.raven_provision_nonces (
  nonce text primary key, source_system text not null check (source_system = 'raven'), key_id text not null,
  seen_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists raven_provision_nonces_expiry on public.raven_provision_nonces(expires_at);
drop trigger if exists raven_provisioning_requests_updated_at on public.raven_provisioning_requests;
create trigger raven_provisioning_requests_updated_at before update on public.raven_provisioning_requests for each row execute function public.fn_set_updated_at();
revoke all on public.raven_provisioning_requests, public.raven_provision_nonces from public, anon, authenticated;
