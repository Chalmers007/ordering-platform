-- =====================================================================
-- 20260913060000_ghl_restaurant_packages.sql
-- Replace placeholder packages with the real restaurant plans, and add
-- what's needed to check out through GHL payment links instead of Stripe.
-- =====================================================================

set lock_timeout = '5s';

-- Each package's real GHL payment link (fastpaydirect.com). Null for any
-- package that should still go through Stripe (kept for future non-GHL
-- packages; all three restaurant plans use GHL).
alter table public.packages
  add column if not exists ghl_payment_link_url text;

-- The original seed data (Starter/Professional/Enterprise) was placeholder
-- content from before real pricing existed. Deactivate rather than delete,
-- since package_purchases can reference these by id.
update public.packages
   set is_active = false
 where name in ('Starter', 'Professional', 'Enterprise');

insert into public.packages (name, description, price_cents, features, ghl_payment_link_url, is_active)
values
  (
    'Restaurant Direct',
    'A branded ordering storefront for pickup - set up, live, and reporting on itself from week one.',
    29700,
    'Vardr OS branded restaurant ordering storefront,Full menu with pickup ordering,Customer order-status page,Basic loyalty,Automatic review follow-up,Weekly performance report',
    'https://link.fastpaydirect.com/payment-link/6aa61bcdceb12d9fc1a8c95c',
    true
  ),
  (
    'Restaurant Growth',
    'Everything in Direct, plus a receptionist that answers the phone and a way to bring past customers back.',
    39700,
    'Everything in Restaurant Direct,AI receptionist - up to 100 minutes / month,One opt-in customer win-back campaign (up to 500 SMS segments / month),Direct delivery available once configured and verified',
    'https://link.fastpaydirect.com/payment-link/6aa61ca032f95ae35594a507',
    true
  ),
  (
    'Restaurant Growth Plus',
    'Everything in Growth, built out further - your own direct-ordering storefront, loyalty customers can scan into, and a fuller view of what it''s producing.',
    49700,
    'Everything in Restaurant Growth,Custom-branded direct-ordering storefront,QR-code loyalty,Automated 30-day win-back SMS for opted-in customers,AI assistant,Expanded revenue dashboard with weekly reports',
    'https://link.fastpaydirect.com/payment-link/6aa61cdf32f95ae35594a508',
    true
  )
on conflict (name) do update
  set description = excluded.description,
      price_cents = excluded.price_cents,
      features = excluded.features,
      ghl_payment_link_url = excluded.ghl_payment_link_url,
      is_active = true,
      updated_at = now();

comment on column public.packages.ghl_payment_link_url is
  'Public GHL (fastpaydirect.com) payment link for this package. Used by GHLProvider instead of creating a Stripe session.';

-- ---------------------------------------------------------------------
-- package_purchases: GHL has no per-checkout session the way Stripe does,
-- so the payment link's own checkout form is the only place we can catch
-- the buyer's email - it becomes the join key the payment-confirmed
-- webhook uses to find this row again. ghl_transaction_id gives the
-- webhook idempotency, same role stripe_payment_intent_id plays today.
-- ---------------------------------------------------------------------
alter table public.package_purchases
  add column if not exists customer_email text,
  add column if not exists ghl_transaction_id text;

create unique index if not exists package_purchases_ghl_transaction_uq
  on public.package_purchases(ghl_transaction_id)
  where ghl_transaction_id is not null;

comment on column public.package_purchases.customer_email is
  'Email captured at "Continue to Payment" time for the GHL flow, since GHL payment links carry no per-checkout reference back to this row. Matched against the payment-confirmed webhook''s contact email.';

comment on column public.package_purchases.ghl_transaction_id is
  'GHL transaction/payment id from the payment-confirmed webhook. Idempotency key so a retried webhook delivery cannot double-confirm.';
