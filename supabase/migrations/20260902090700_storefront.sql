-- =====================================================================
-- 20260902090700_storefront.sql
-- Customer-facing additions: the signup reward the post-checkout upsell
-- promises, and the storefront's menu read path.
--
-- The reward is recorded as a real entitlement rather than being implied
-- by UI copy. There is no promotions engine yet (price_cart() still
-- returns discountCents = 0), so nothing redeems these rows -- but a
-- customer who accepted the offer has a durable claim, instead of the
-- platform having made a promise it kept no record of.
-- =====================================================================

set check_function_bodies = off;

create type public.reward_status as enum ('granted', 'redeemed', 'expired', 'revoked');

create table public.customer_rewards (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null,
  amount_cents integer not null,
  status       public.reward_status not null default 'granted',
  granted_for_order_id uuid references public.orders(id) on delete set null,
  redeemed_on_order_id uuid references public.orders(id) on delete set null,
  expires_at   timestamptz,
  granted_at   timestamptz not null default now(),
  redeemed_at  timestamptz,

  constraint customer_rewards_amount_chk check (amount_cents > 0 and amount_cents <= 100000),
  constraint customer_rewards_kind_chk check (kind ~ '^[a-z0-9_]{3,48}$'),
  constraint customer_rewards_redeemed_chk
    check ((status = 'redeemed') = (redeemed_at is not null))
);

-- One signup reward per customer per restaurant, ever.
create unique index customer_rewards_one_signup_idx
  on public.customer_rewards (tenant_id, user_id, kind)
  where kind = 'account_signup';
create index customer_rewards_user_idx on public.customer_rewards (user_id, status);
create index customer_rewards_tenant_idx on public.customer_rewards (tenant_id, status);

alter table public.customer_rewards enable row level security;

-- A customer sees their own rewards; staff see their tenant's.
create policy customer_rewards_select on public.customer_rewards
  for select to authenticated
  using (user_id = auth.uid() or public.has_tenant_access(tenant_id));

-- Granting goes through the function below, never a direct insert.
revoke all on public.customer_rewards from anon, authenticated;
grant select on public.customer_rewards to authenticated;

comment on table public.customer_rewards is
  'Entitlements granted to customers. No redemption path exists yet -- see the promotions slice.';

-- ---------------------------------------------------------------------
-- complete_customer_account()
--
-- The post-checkout upsell: a guest who verified by SMS already has an
-- auth user, so "registering" means attaching an email and consenting to
-- marketing. Returns the reward, if this earned one.
--
-- Idempotent: calling it twice does not grant a second reward.
-- ---------------------------------------------------------------------
create or replace function public.complete_customer_account(
  p_tenant_id        uuid,
  p_email            text default null,
  p_full_name        text default null,
  p_marketing_opt_in boolean default false,
  p_order_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_reward_cents  constant integer := 500;   -- the $5.00 the upsell offers
  v_reward        public.customer_rewards%rowtype;
  v_granted       boolean := false;
begin
  if v_uid is null then
    raise exception 'You must be signed in to save your details'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id and status = 'active') then
    raise exception 'Unknown restaurant' using errcode = 'check_violation';
  end if;

  -- The order must belong to this customer, if one was named.
  if p_order_id is not null
     and not exists (
       select 1 from public.orders
       where id = p_order_id and tenant_id = p_tenant_id and customer_user_id = v_uid
     )
  then
    raise exception 'That order is not yours' using errcode = 'insufficient_privilege';
  end if;

  update public.user_profiles
     set email = coalesce(nullif(btrim(p_email), ''), email),
         full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         marketing_opt_in = p_marketing_opt_in,
         tenant_id = coalesce(tenant_id, p_tenant_id)
   where id = v_uid;

  -- Marketing consent is what the offer is for; the reward follows it.
  if p_marketing_opt_in then
    insert into public.customer_rewards
      (tenant_id, user_id, kind, amount_cents, granted_for_order_id, expires_at)
    values
      (p_tenant_id, v_uid, 'account_signup', v_reward_cents, p_order_id, now() + interval '90 days')
    on conflict (tenant_id, user_id, kind) where kind = 'account_signup' do nothing
    returning * into v_reward;

    v_granted := v_reward.id is not null;
  end if;

  if not v_granted then
    select * into v_reward
    from public.customer_rewards
    where tenant_id = p_tenant_id and user_id = v_uid and kind = 'account_signup';
  end if;

  return jsonb_build_object(
    'saved', true,
    'rewardGranted', v_granted,
    'rewardAmountCents', v_reward.amount_cents,
    'rewardExpiresAt', v_reward.expires_at
  );
end;
$$;

revoke all on function public.complete_customer_account(uuid, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_customer_account(uuid, text, text, boolean, uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- get_delivery_tracking()
--
-- The white-labelled tracking read. Returns only what a customer may see:
-- no external_ref, no provider name, no payment identifiers. Callable by
-- the order's owner (RLS-equivalent check inside) or with the order's
-- tracking token.
-- ---------------------------------------------------------------------
create or replace function public.get_delivery_tracking(
  p_order_id uuid default null,
  p_token    uuid default null
)
returns table (
  order_id              uuid,
  tenant_id             uuid,
  order_number          text,
  order_status          public.order_status,
  fulfillment_type      public.fulfillment_type,
  promised_at           timestamptz,
  placed_at             timestamptz,
  completed_at          timestamptz,
  delivery_status       public.delivery_status,
  driver_name           text,
  driver_phone          text,
  latitude              double precision,
  longitude             double precision,
  heading               double precision,
  location_updated_at   timestamptz,
  estimated_delivery_at timestamptz,
  -- Internal: lets the API route decide whether to refresh from the
  -- courier. Never serialised to a client response.
  has_external_ref      boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.id, o.tenant_id, o.order_number, o.status, o.fulfillment_type,
    o.promised_at, o.placed_at, o.completed_at,
    d.status, d.courier_name, d.courier_phone,
    d.courier_latitude, d.courier_longitude, d.courier_heading,
    d.location_updated_at, d.estimated_delivery_at,
    d.external_ref is not null
  from public.orders o
  left join public.deliveries d on d.order_id = o.id
  where o.status <> 'draft'
    and (
      (p_order_id is not null and o.id = p_order_id
        and (o.customer_user_id = auth.uid() or public.has_tenant_access(o.tenant_id)))
      or
      (p_token is not null and o.tracking_token = p_token
        and o.created_at > now() - interval '30 days')
    );
$$;

revoke all on function public.get_delivery_tracking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_delivery_tracking(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: the tracking page subscribes to its own order and delivery.
-- deliveries already carries REPLICA IDENTITY FULL requirements for the
-- same reason orders does -- a filtered RLS UPDATE with only a primary key
-- cannot be evaluated, and Realtime drops it silently.
-- ---------------------------------------------------------------------
alter table public.customer_rewards replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customer_rewards'
    ) then
      alter publication supabase_realtime add table public.customer_rewards;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- resolve_checkout_order()
--
-- The customer returns from Stripe before the webhook has necessarily
-- landed, and they hold a checkout session id -- not an order id, which
-- does not exist yet. This resolves one to the other, for the person who
-- opened that checkout and nobody else.
--
-- Returns null while the order is still being created, which is a state
-- the return page waits on rather than an error.
-- ---------------------------------------------------------------------
create or replace function public.resolve_checkout_order(p_session_id uuid)
returns table (order_id uuid, tracking_token uuid, session_status public.checkout_session_status)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cs.order_id, o.tracking_token, cs.status
  from public.checkout_sessions cs
  left join public.orders o on o.id = cs.order_id
  where cs.id = p_session_id
    and cs.created_by is not null
    and cs.created_by = auth.uid();
$$;

revoke all on function public.resolve_checkout_order(uuid) from public, anon, authenticated;
grant execute on function public.resolve_checkout_order(uuid) to authenticated;
