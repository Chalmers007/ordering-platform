-- =====================================================================
-- 20260909000100_packages.sql
-- Restaurant packages for claim flow
--
-- Restaurants select a package during claim. Each package includes
-- features, pricing, and setup terms. Used by the Vardr-branded
-- claim/checkout flow (separate from demo builder auth).
-- =====================================================================

set lock_timeout = '5s';

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  -- Price in cents. 0 for free tiers, null for contact-us pricing.
  price_cents int check (price_cents >= 0),
  -- Comma-separated features displayed to restaurant during claim
  features text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Default packages (can be overridden via admin UI)
insert into public.packages (name, description, price_cents, features, is_active)
values
  ('Starter', 'Perfect for getting started', 0, 'Basic menu, Standard delivery, Email support', true),
  ('Professional', 'Grow your business', 9999, 'Advanced menu, Premium delivery, Priority support, Custom branding', true),
  ('Enterprise', 'Full platform access', null, 'Unlimited features, Dedicated support, Custom integrations', true)
on conflict (name) do nothing;

-- Trigger for updated_at
drop trigger if exists packages_updated_at on public.packages;
create trigger packages_updated_at
  before update on public.packages
  for each row
  execute function public.fn_set_updated_at();

-- RLS: packages are public (readable by anyone during claim flow)
alter table public.packages enable row level security;
create policy packages_select_public on public.packages
  for select using (true);
revoke insert, update, delete on public.packages from public, anon, authenticated;

comment on table public.packages is
  'Restaurant packages available during claim flow. '
  'Free and paid tiers with features and pricing.';

comment on column public.packages.price_cents is
  'Price in cents. 0 = free tier. null = contact for pricing (Enterprise).';

comment on column public.packages.features is
  'Comma-separated features displayed during package selection.';
