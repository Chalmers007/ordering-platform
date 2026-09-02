-- =====================================================================
-- 20260902090400_security.sql
-- Authorisation helpers, integrity guards, and Row Level Security.
--
-- Model
-- -----
--   super_admin   : no tenant binding; every policy grants it access via
--                   is_super_admin(). This is what makes impersonation
--                   work -- the admin app simply scopes its queries to
--                   the impersonated tenant_id, and RLS gets out of the
--                   way instead of being bypassed with a service key in
--                   a browser-reachable path.
--   tenant_owner  : full control of exactly one tenant, including money
--                   and gateway connections.
--   tenant_staff  : operational control (menu, orders, kitchen) but no
--                   billing, gateways, domains, or audit log.
--   customer      : own orders only.
--   anon          : published catalogue of ACTIVE tenants, plus order
--                   tracking by opaque token.
--
-- All helpers are SECURITY DEFINER so they read user_profiles without
-- re-entering that table's own policies (which would recurse).
-- =====================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------
-- Authorisation helpers
-- ---------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  );
$$;

comment on function public.is_super_admin() is
  'True when the calling JWT belongs to a platform super admin. SECURITY DEFINER: reads user_profiles without recursing into its RLS policies.';

create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.user_profiles p where p.id = auth.uid();
$$;

create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.tenant_id from public.user_profiles p where p.id = auth.uid();
$$;

-- Owner or staff of this exact tenant.
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.tenant_id = p_tenant_id
      and p.role in ('tenant_owner', 'tenant_staff')
  );
$$;

create or replace function public.is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.tenant_id = p_tenant_id
      and p.role = 'tenant_owner'
  );
$$;

-- Staff-level reach: the working surface of app.<platform>
create or replace function public.has_tenant_access(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_super_admin() or public.is_tenant_member(p_tenant_id);
$$;

-- Owner-level reach: money, gateways, domains, audit.
create or replace function public.can_manage_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_super_admin() or public.is_tenant_owner(p_tenant_id);
$$;

-- Is this tenant's storefront allowed to serve the public right now?
create or replace function public.is_storefront_public(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id and t.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- Integrity guards
-- RLS decides which ROWS you may touch. These triggers decide which
-- COLUMNS -- something RLS cannot express.
-- ---------------------------------------------------------------------

-- Only the platform may move a tenant's status or SaaS billing state.
create or replace function public.fn_guard_tenant_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_super_admin() or auth.uid() is null then
    return new;  -- platform operator, or a service-role/back-office write
  end if;

  if new.status is distinct from old.status
     or new.subscription_status is distinct from old.subscription_status
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.slug is distinct from old.slug
  then
    raise exception 'Only a platform administrator may change tenant status, billing, or slug'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger tenants_guard_privileged_columns
  before update on public.tenants
  for each row execute function public.fn_guard_tenant_privileged_columns();

-- Staff may run the kitchen; only owners/platform may change money.
create or replace function public.fn_guard_tenant_settings_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.can_manage_tenant(new.tenant_id) then
    return new;
  end if;

  if new.tech_fee_enabled is distinct from old.tech_fee_enabled
     or new.tech_fee_cents is distinct from old.tech_fee_cents
     or new.delivery_fee_cents is distinct from old.delivery_fee_cents
     or new.delivery_minimum_cents is distinct from old.delivery_minimum_cents
     or new.service_fee_bps is distinct from old.service_fee_bps
     or new.tax_rate_bps is distinct from old.tax_rate_bps
  then
    raise exception 'Only the restaurant owner may change fees or tax settings'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger tenant_settings_guard_columns
  before update on public.tenant_settings
  for each row execute function public.fn_guard_tenant_settings_columns();

-- Nobody promotes themselves. Role and tenant binding are platform-owned;
-- a tenant owner may manage roles inside their own tenant only.
create or replace function public.fn_guard_user_profile_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;

  if new.role is distinct from old.role or new.tenant_id is distinct from old.tenant_id then
    if not public.is_tenant_owner(old.tenant_id)
       or new.tenant_id is distinct from old.tenant_id
       or new.role not in ('tenant_owner', 'tenant_staff', 'customer')
       or old.role = 'super_admin'
    then
      raise exception 'Insufficient privilege to change role or tenant assignment'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger user_profiles_guard_columns
  before update on public.user_profiles
  for each row execute function public.fn_guard_user_profile_columns();

-- A customer owns their cart, not their invoice. Once an order leaves
-- draft, only staff/platform may touch it.
create or replace function public.fn_guard_order_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.has_tenant_access(new.tenant_id) then
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'This order can no longer be modified'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status not in ('draft', 'pending_payment')
     or new.payment_status is distinct from old.payment_status
     or new.application_fee_cents is distinct from old.application_fee_cents
     or new.refunded_cents is distinct from old.refunded_cents
     or new.tenant_id is distinct from old.tenant_id
     or new.order_number is distinct from old.order_number
  then
    raise exception 'Insufficient privilege to modify order state'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger orders_guard_mutation
  before update on public.orders
  for each row execute function public.fn_guard_order_mutation();

-- ---------------------------------------------------------------------
-- Money integrity
-- Deferred so a checkout can insert the order and its lines in one
-- transaction and still be checked as a whole at COMMIT.
-- ---------------------------------------------------------------------
create or replace function public.fn_validate_order_totals()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_items_total    integer;
  v_fee_enabled    boolean;
  v_fee_cents      integer;
  v_expected_fee   integer;
begin
  if new.status = 'draft' then
    return null;
  end if;

  select coalesce(sum(oi.line_total_cents), 0)
    into v_items_total
  from public.order_items oi
  where oi.order_id = new.id;

  if v_items_total <> new.subtotal_cents then
    raise exception
      'Order % subtotal (% cents) does not match its line items (% cents)',
      new.order_number, new.subtotal_cents, v_items_total
      using errcode = 'check_violation';
  end if;

  select ts.tech_fee_enabled, ts.tech_fee_cents
    into v_fee_enabled, v_fee_cents
  from public.tenant_settings ts
  where ts.tenant_id = new.tenant_id;

  v_expected_fee := case when coalesce(v_fee_enabled, false) then coalesce(v_fee_cents, 0) else 0 end;

  if new.tech_fee_cents <> v_expected_fee then
    raise exception
      'Order % tech fee (% cents) does not match tenant configuration (% cents)',
      new.order_number, new.tech_fee_cents, v_expected_fee
      using errcode = 'check_violation';
  end if;

  -- The platform's cut must be exactly the tech fee -- never a share of
  -- the restaurant's revenue.
  if new.application_fee_cents > new.tech_fee_cents then
    raise exception 'Order % platform fee exceeds the configured tech fee', new.order_number
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger orders_validate_totals
  after insert or update on public.orders
  deferrable initially deferred
  for each row execute function public.fn_validate_order_totals();

-- ---------------------------------------------------------------------
-- Public read RPCs
-- ---------------------------------------------------------------------

-- Host -> tenant resolution for the edge middleware. Runs as definer so
-- the middleware needs nothing but the anon key.
create or replace function public.resolve_storefront(
  p_hostname text default null,
  p_slug     text default null
)
returns table (
  tenant_id        uuid,
  slug             text,
  name             text,
  status           public.tenant_status,
  is_custom_domain boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.slug, t.name, t.status, true
  from public.tenant_domains d
  join public.tenants t on t.id = d.tenant_id
  where p_hostname is not null
    and d.hostname = lower(p_hostname)
    and d.verified_at is not null
  union all
  select t.id, t.slug, t.name, t.status, false
  from public.tenants t
  where p_slug is not null
    and t.slug = lower(p_slug)
    and not exists (
      select 1 from public.tenant_domains d2
      join public.tenants t2 on t2.id = d2.tenant_id
      where p_hostname is not null
        and d2.hostname = lower(p_hostname)
        and d2.verified_at is not null
    )
  limit 1;
$$;

-- Guest order tracking. Deliberately narrow: no payment identifiers and
-- no dispatch provider reference ever leave this function.
create or replace function public.get_order_by_tracking_token(p_token uuid)
returns table (
  id                    uuid,
  tenant_id             uuid,
  order_number          text,
  status                public.order_status,
  fulfillment_type      public.fulfillment_type,
  customer_name         text,
  subtotal_cents        integer,
  discount_cents        integer,
  tax_cents             integer,
  tip_cents             integer,
  delivery_fee_cents    integer,
  service_fee_cents     integer,
  tech_fee_cents        integer,
  total_cents           integer,
  currency              char(3),
  promised_at           timestamptz,
  placed_at             timestamptz,
  completed_at          timestamptz,
  delivery_status       public.delivery_status,
  courier_name          text,
  courier_latitude      double precision,
  courier_longitude     double precision,
  location_updated_at   timestamptz,
  estimated_delivery_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.id, o.tenant_id, o.order_number, o.status, o.fulfillment_type,
    o.customer_name, o.subtotal_cents, o.discount_cents, o.tax_cents,
    o.tip_cents, o.delivery_fee_cents, o.service_fee_cents, o.tech_fee_cents,
    o.total_cents, o.currency, o.promised_at, o.placed_at, o.completed_at,
    d.status, d.courier_name, d.courier_latitude, d.courier_longitude,
    d.location_updated_at, d.estimated_delivery_at
  from public.orders o
  left join public.deliveries d on d.order_id = o.id
  where o.tracking_token = p_token
    and o.status <> 'draft'
    and o.created_at > now() - interval '30 days';
$$;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere. Nothing in public is left unguarded.
-- ---------------------------------------------------------------------
alter table public.tenants                    enable row level security;
alter table public.tenant_domains             enable row level security;
alter table public.tenant_settings            enable row level security;
alter table public.tenant_secrets             enable row level security;
alter table public.tenant_order_counters      enable row level security;
alter table public.reserved_subdomains        enable row level security;
alter table public.user_profiles              enable row level security;
alter table public.payment_gateway_accounts   enable row level security;
alter table public.impersonation_sessions     enable row level security;
alter table public.menu_categories            enable row level security;
alter table public.menu_items                 enable row level security;
alter table public.menu_modifier_groups       enable row level security;
alter table public.menu_modifiers             enable row level security;
alter table public.menu_item_modifier_groups  enable row level security;
alter table public.orders                     enable row level security;
alter table public.order_items                enable row level security;
alter table public.order_item_modifiers       enable row level security;
alter table public.order_status_events        enable row level security;
alter table public.deliveries                 enable row level security;
alter table public.webhook_events             enable row level security;
alter table public.audit_logs                 enable row level security;

-- Force RLS on the tables whose owner could otherwise read them freely.
alter table public.tenant_secrets  force row level security;
alter table public.audit_logs      force row level security;

-- =====================================================================
-- POLICIES
-- =====================================================================

-- --- reserved_subdomains: public read, platform write ----------------
create policy reserved_subdomains_read on public.reserved_subdomains
  for select to anon, authenticated using (true);
create policy reserved_subdomains_write on public.reserved_subdomains
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- --- tenants ---------------------------------------------------------
create policy tenants_select on public.tenants
  for select to anon, authenticated
  using (status = 'active' or public.has_tenant_access(id));

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (public.is_super_admin());

-- Owners may edit their own brand; the guard trigger blocks status/billing.
create policy tenants_update on public.tenants
  for update to authenticated
  using (public.can_manage_tenant(id))
  with check (public.can_manage_tenant(id));

create policy tenants_delete on public.tenants
  for delete to authenticated
  using (public.is_super_admin());

-- --- tenant_domains --------------------------------------------------
-- Verified hostnames are public routing data, read by the edge middleware
-- with the anon key on every custom-domain request.
create policy tenant_domains_select on public.tenant_domains
  for select to anon, authenticated
  using (verified_at is not null or public.has_tenant_access(tenant_id));

create policy tenant_domains_write on public.tenant_domains
  for all to authenticated
  using (public.can_manage_tenant(tenant_id))
  with check (public.can_manage_tenant(tenant_id));

-- --- tenant_settings -------------------------------------------------
create policy tenant_settings_select on public.tenant_settings
  for select to anon, authenticated
  using (public.is_storefront_public(tenant_id) or public.has_tenant_access(tenant_id));

create policy tenant_settings_insert on public.tenant_settings
  for insert to authenticated
  with check (public.can_manage_tenant(tenant_id));

-- Staff get UPDATE so the KDS pause/prep-time controls work; the guard
-- trigger keeps them out of the fee columns.
create policy tenant_settings_update on public.tenant_settings
  for update to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

-- --- tenant_secrets --------------------------------------------------
-- No policies, by design. service_role only.

-- --- tenant_order_counters -------------------------------------------
-- No policies. Written exclusively by fn_orders_assign_number().

-- --- user_profiles ---------------------------------------------------
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin()
    or (tenant_id is not null and public.is_tenant_member(tenant_id))
  );

create policy user_profiles_insert on public.user_profiles
  for insert to authenticated
  with check (
    id = auth.uid()
    or public.is_super_admin()
    or (tenant_id is not null and public.is_tenant_owner(tenant_id))
  );

create policy user_profiles_update on public.user_profiles
  for update to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin()
    or (tenant_id is not null and public.is_tenant_owner(tenant_id))
  )
  with check (
    id = auth.uid()
    or public.is_super_admin()
    or (tenant_id is not null and public.is_tenant_owner(tenant_id))
  );

create policy user_profiles_delete on public.user_profiles
  for delete to authenticated
  using (public.is_super_admin());

-- --- payment_gateway_accounts (owner + platform only) ----------------
create policy payment_gateway_accounts_select on public.payment_gateway_accounts
  for select to authenticated
  using (public.can_manage_tenant(tenant_id));

create policy payment_gateway_accounts_write on public.payment_gateway_accounts
  for all to authenticated
  using (public.can_manage_tenant(tenant_id))
  with check (public.can_manage_tenant(tenant_id));

-- --- impersonation_sessions (platform only) --------------------------
create policy impersonation_sessions_all on public.impersonation_sessions
  for all to authenticated
  using (public.is_super_admin() and super_admin_id = auth.uid())
  with check (public.is_super_admin() and super_admin_id = auth.uid());

-- --- catalogue -------------------------------------------------------
create policy menu_categories_select on public.menu_categories
  for select to anon, authenticated
  using (
    (is_active and public.is_storefront_public(tenant_id))
    or public.has_tenant_access(tenant_id)
  );

create policy menu_categories_write on public.menu_categories
  for all to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

-- Unavailable items stay readable: the storefront renders them as
-- "sold out" rather than silently dropping them from the menu.
create policy menu_items_select on public.menu_items
  for select to anon, authenticated
  using (public.is_storefront_public(tenant_id) or public.has_tenant_access(tenant_id));

create policy menu_items_write on public.menu_items
  for all to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

create policy menu_modifier_groups_select on public.menu_modifier_groups
  for select to anon, authenticated
  using (
    (is_active and public.is_storefront_public(tenant_id))
    or public.has_tenant_access(tenant_id)
  );

create policy menu_modifier_groups_write on public.menu_modifier_groups
  for all to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

create policy menu_modifiers_select on public.menu_modifiers
  for select to anon, authenticated
  using (public.is_storefront_public(tenant_id) or public.has_tenant_access(tenant_id));

create policy menu_modifiers_write on public.menu_modifiers
  for all to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

create policy menu_item_modifier_groups_select on public.menu_item_modifier_groups
  for select to anon, authenticated
  using (public.is_storefront_public(tenant_id) or public.has_tenant_access(tenant_id));

create policy menu_item_modifier_groups_write on public.menu_item_modifier_groups
  for all to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

-- --- orders ----------------------------------------------------------
create policy orders_select on public.orders
  for select to authenticated
  using (
    public.has_tenant_access(tenant_id)
    or (customer_user_id is not null and customer_user_id = auth.uid())
  );

create policy orders_insert on public.orders
  for insert to authenticated
  with check (
    public.has_tenant_access(tenant_id)
    or (
      customer_user_id = auth.uid()
      and public.is_storefront_public(tenant_id)
      and application_fee_cents = 0
      and refunded_cents = 0
      and payment_status = 'unpaid'
      and status in ('draft', 'pending_payment')
    )
  );

create policy orders_update on public.orders
  for update to authenticated
  using (
    public.has_tenant_access(tenant_id)
    or (customer_user_id is not null and customer_user_id = auth.uid())
  )
  with check (
    public.has_tenant_access(tenant_id)
    or (customer_user_id is not null and customer_user_id = auth.uid())
  );

create policy orders_delete on public.orders
  for delete to authenticated
  using (public.is_super_admin());

-- --- order lines (inherit the parent order's reach) ------------------
create policy order_items_all on public.order_items
  for all to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (public.has_tenant_access(o.tenant_id) or o.customer_user_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          public.has_tenant_access(o.tenant_id)
          or (o.customer_user_id = auth.uid() and o.status in ('draft', 'pending_payment'))
        )
    )
  );

create policy order_item_modifiers_all on public.order_item_modifiers
  for all to authenticated
  using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_modifiers.order_item_id
        and (public.has_tenant_access(o.tenant_id) or o.customer_user_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_modifiers.order_item_id
        and (
          public.has_tenant_access(o.tenant_id)
          or (o.customer_user_id = auth.uid() and o.status in ('draft', 'pending_payment'))
        )
    )
  );

-- Append-only history: readable, never client-writable.
create policy order_status_events_select on public.order_status_events
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_status_events.order_id
        and (public.has_tenant_access(o.tenant_id) or o.customer_user_id = auth.uid())
    )
  );

-- --- deliveries ------------------------------------------------------
create policy deliveries_select on public.deliveries
  for select to authenticated
  using (
    public.has_tenant_access(tenant_id)
    or exists (
      select 1 from public.orders o
      where o.id = deliveries.order_id and o.customer_user_id = auth.uid()
    )
  );

-- Dispatch rows are written by the Edge Function (service_role); staff may
-- correct courier details from the dashboard.
create policy deliveries_write on public.deliveries
  for all to authenticated
  using (public.has_tenant_access(tenant_id))
  with check (public.has_tenant_access(tenant_id));

-- --- webhook_events (observability only; the worker uses service_role) -
create policy webhook_events_select on public.webhook_events
  for select to authenticated
  using (public.can_manage_tenant(tenant_id));

-- --- audit_logs ------------------------------------------------------
-- SELECT only. There is deliberately no INSERT/UPDATE/DELETE policy for
-- any client role: rows arrive solely from fn_audit_log().
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id is not null and public.is_tenant_owner(tenant_id))
  );

-- =====================================================================
-- GRANTS
-- Explicit, table by table. RLS decides rows; these decide verbs.
-- =====================================================================
revoke all on all tables in schema public from anon, authenticated;

grant select on
  public.tenants, public.tenant_domains, public.tenant_settings,
  public.reserved_subdomains, public.menu_categories, public.menu_items,
  public.menu_modifier_groups, public.menu_modifiers,
  public.menu_item_modifier_groups
to anon, authenticated;

grant select, insert, update, delete on
  public.orders, public.order_items, public.order_item_modifiers
to authenticated;

grant select on
  public.order_status_events, public.audit_logs, public.webhook_events,
  public.user_profiles, public.payment_gateway_accounts, public.deliveries
to authenticated;

grant insert, update, delete on
  public.user_profiles, public.payment_gateway_accounts, public.deliveries,
  public.tenant_domains, public.tenant_settings, public.tenants,
  public.menu_categories, public.menu_items, public.menu_modifier_groups,
  public.menu_modifiers, public.menu_item_modifier_groups,
  public.impersonation_sessions, public.reserved_subdomains
to authenticated;

grant select on public.impersonation_sessions to authenticated;

-- tenant_secrets and tenant_order_counters: no grants at all.

grant execute on function
  public.is_super_admin(),
  public.auth_role(),
  public.auth_tenant_id(),
  public.is_tenant_member(uuid),
  public.is_tenant_owner(uuid),
  public.has_tenant_access(uuid),
  public.can_manage_tenant(uuid),
  public.is_storefront_public(uuid)
to anon, authenticated;

grant execute on function public.resolve_storefront(text, text) to anon, authenticated;
grant execute on function public.get_order_by_tracking_token(uuid) to anon, authenticated;

-- The audit trail must never be rewritten, not even by its owner.
revoke update, delete on public.audit_logs from anon, authenticated;

-- =====================================================================
-- REALTIME
-- REPLICA IDENTITY FULL is required, not optional: without it Postgres
-- emits only the primary key for UPDATEs, RLS cannot evaluate the row
-- filter, and Realtime silently drops the event for every subscriber.
-- =====================================================================
alter table public.orders            replica identity full;
alter table public.order_items       replica identity full;
alter table public.deliveries        replica identity full;
alter table public.tenant_settings   replica identity full;
alter table public.menu_items        replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.orders,
      public.order_items,
      public.order_status_events,
      public.deliveries,
      public.tenant_settings,
      public.menu_items;
  end if;
end;
$$;
