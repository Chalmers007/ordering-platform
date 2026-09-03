# Ordering Platform

Multi-tenant, white-label restaurant delivery and online ordering.
Next.js (App Router) + Supabase (Postgres, Auth, Realtime, Edge Functions) on Vercel.

## The three surfaces

One deployment, one middleware, three products:

| Host | Rewrites to | Audience |
| --- | --- | --- |
| `admin.<root>` | `/admin/*` | Platform super-admin: tenants, SaaS billing, the $1.00 tech-fee toggle, impersonation |
| `app.<root>` | `/app/*` | Restaurant staff: menu builder, orders, KDS, printer setup |
| `<tenant>.<root>` | `/store/*` | White-labelled customer storefront |
| `orders.joespizza.com` | `/store/*` | The same storefront on the tenant's own domain |
| `<root>`, `www.<root>` | `/(marketing)` | Platform marketing site |

`middleware.ts` resolves the host, refreshes the Supabase session, and pins the
tenant to request headers (`x-tenant-id`, `x-tenant-slug`, `x-surface`). Those
headers are **stripped from every inbound request first**, so a client cannot
forge one. Custom-domain lookups go through `resolve_storefront()` and are
memoised per edge instance for 60s, negative results included.

## Security model

Isolation lives in Postgres, not in application code.

- Every tenant-scoped table carries `tenant_id ... ON DELETE CASCADE`, and RLS
  is enabled on all 21 tables in `public`.
- `is_super_admin()` is `SECURITY DEFINER`, so it reads `user_profiles` without
  recursing into that table's own policies. Every policy grants super-admins
  access — that is what makes impersonation work without putting a service-role
  key anywhere a browser can reach.
- RLS decides which **rows** you may touch. Guard triggers decide which
  **columns**: staff can pause the kitchen but not change the tech fee; nobody
  can promote themselves; a customer's order is frozen the moment it leaves
  `draft`.
- `tenant_secrets` (Shipday keys, Square tokens, GHL webhook URLs) has RLS
  enabled with **zero policies** and no grants — `service_role` only.
- `audit_logs` is append-only: `SELECT` policy only, and `UPDATE`/`DELETE` are
  revoked outright. Rows arrive solely from `fn_audit_log()`.

## Money integrity

Money is integer cents everywhere. Three layers enforce it:

1. `orders_total_chk` — `total = subtotal − discount + tax + tip + delivery + service + tech`.
2. `order_items_total_chk` — `line_total = (unit_price + modifiers) × quantity`.
3. A **deferred** constraint trigger at COMMIT: the order's subtotal must equal
   the sum of its line items, `tech_fee_cents` must equal the tenant's
   configured fee (0 when disabled), and the platform's cut may never exceed
   that fee. A checkout cannot skip the fee or invent one, whatever the client
   sends.

## Checkout, the fee split, and dispatch

**Money is computed in one place.** `price_cart()` (SQL) reads every price from
the database; the API route passes only the customer's *selections*. Nothing
the client says about money is read. The priced result is persisted to
`checkout_sessions` and Stripe metadata carries only that row's id plus a
SHA-256 `cart_hash` — Stripe metadata caps at 500 characters per value, which
a cart with modifiers blows through immediately.

**The split** is a Stripe destination charge:
`application_fee_amount` = the tenant's flat technology fee (never a
percentage of the restaurant's revenue), `transfer_data.destination` and
`on_behalf_of` = the connected account. A $20.00 order with the fee enabled
charges the customer $21.00, routes $1.00 to the platform and settles $20.00
to the restaurant.

**Three layers have to agree** or the order does not exist:

1. `computeApplicationFeeCents()` refuses to build a session where the cart's
   tech fee differs from the tenant's configuration.
2. `buildCheckoutSessionParams()` refuses to charge line items that do not sum
   to the cart total.
3. The deferred constraint trigger re-derives the subtotal from the inserted
   line items and re-checks `tech_fee_cents` against `tenant_settings` at
   COMMIT. A tampered snapshot — skipping the fee, inflating it, or faking a
   subtotal — rolls back the whole transaction.

**The webhook is idempotent by construction.** Every event is inserted into
`inbound_webhook_events` first; the unique index on `(provider, event_id)` is
the guarantee, and a redelivery loses that insert and returns before touching
an order. Order creation is a single SQL function, so `orders`, `order_items`,
`order_item_modifiers`, `deliveries` and the outbound GHL events are one
transaction.

**Dispatch is silent.** The Edge Function is the only code that knows which
courier network is used. It is invoked server-to-server with the service-role
key, reads the tenant's key from `tenant_secrets` (RLS on, zero policies, zero
grants), and writes the provider's job id to `deliveries.external_ref` — never
to `orders`, which customers can read. Provider errors are logged, not
returned, so a caller cannot fingerprint the courier from an error message. A
dispatch failure never fails the payment webhook: the order is paid and the
kitchen needs it, so the delivery row stays `unassigned` with the reason
recorded.

## The storefront

`middleware.ts` rewrites a storefront host to `/store/*`, so the pages live in
the `(storefront)` route group under a `store` segment — the group organises,
the segment is what the rewrite targets.

**Prices are never computed in the browser.** The cart holds selections and
quantities only. Every figure the customer sees at checkout comes from
`/api/cart/validate` → `price_cart()`, re-requested whenever the cart changes.
A client that skips validation does not get a wrong price — it gets a
rejection, because `/api/checkout` re-prices from scratch and the deferred
constraint trigger re-checks the result at COMMIT.

**Kitchen pacing is live.** The storefront subscribes to `tenant_settings`, so
a pause from the KDS disables checkout immediately rather than at the
customer's next page load — by which time they could be mid-checkout.

**Tracking is white-labelled by construction.** `get_delivery_tracking()`
authorises first (the order's owner, the tenant's staff, or the holder of the
order's opaque token), and `toTrackingResponse()` builds an allow-listed
payload field by field. Spreading a row there would mean a column added later
starts publishing itself; a test asserts no vendor name, job reference, or
credential can appear in the serialised response.

**The return from Stripe waits for the webhook.** The customer comes back
holding a checkout session id — the order does not exist until the webhook
lands. `/store/orders/session/[sessionId]` polls `resolve_checkout_order()`
and forwards to live tracking, so a slow webhook is a wait, not a 404.

**The $5 upsell is an entitlement, not copy.** Accepting writes a real
`customer_rewards` row. Nothing redeems it yet — `price_cart()` still returns
`discountCents: 0` until the promotions slice — but the claim is recorded
rather than merely promised.

## Kitchen Display System

Reached at `app.<root>/kds`, which middleware rewrites to `/app/kds` — hence
the `app` segment inside the `(kds)` route group. The tenant comes from the
signed-in staff member's profile, not from a host header: staff belong to one
restaurant and must see only its board.

**Realtime carries the fact, not the state.** An INSERT/UPDATE payload is flat
and has no line items, so an event triggers a scoped re-read of that one order
rather than being trusted as the new ticket. That re-read passes back through
RLS, and `belongsToTenant()` checks the tenant a third time in the client —
because a board that ever renders another restaurant's order is the worst
failure this product has.

**Transitions are a table, not a free UPDATE.** `advance_order_status()`
refuses to move an order backwards, to dispatch a pickup order, or to be
called by anyone outside the kitchen. The board offers buttons; the database
decides what is legal.

**Pacing sends a delta.** `adjust_prep_time()` takes `±5`, so two expediters
tapping at once add ten minutes instead of racing to the same number.

**Audit keeps the verb and the intent apart.** `audit_logs.action` stays the
DML verb (`INSERT`/`UPDATE`/`DELETE`); a new `operation` column carries the
semantic label (`TOGGLE_KITCHEN_PAUSE`, `ADVANCE_ORDER_STATUS`,
`ADJUST_PREP_TIME`), set by the RPC through a transaction-local GUC that
`fn_audit_log()` reads. The trail stays readable as database history *and* as
"who paused the kitchen at 7pm".

## Thermal printing

`escpos.ts` is pure: bytes in, bytes out, no I/O. `renderTicket()` returns both
the ESC/POS stream and a plain-text rendering of the same ticket, which is what
makes receipts testable without hardware. Cut is `GS V 0`, drawer kick is
`DLE DC4 1 1 1`, and the builder feeds paper before cutting because the cutter
sits above the print head.

Transports, honestly labelled — a browser cannot open a raw TCP socket:

- **Bluetooth** — Web Bluetooth, tablet straight to printer. The only fully
  in-browser path.
- **Network** — `/api/print/network` opens the socket server-side. Works when
  the app is hosted on the kitchen's own network; from a cloud host it cannot
  reach a private address, and the route says so rather than timing out.
- **Print bridge** — a WebSocket agent on the kitchen LAN. The path that works
  from a cloud deployment.
- **Browser print** — the text rendering through the normal print dialog.

Printer settings live in `localStorage` per device, not in `tenant_settings`:
two tablets in one kitchen legitimately drive different printers.

## Platform console

`admin.<root>` rewrites to `/admin/*`. The layout calls `requireSuperAdmin()`,
which asks the database via `is_super_admin()` rather than trusting a claim in
the session — and a signed-in non-admin gets a real HTTP 403 through
`forbidden()`, not a 200 that merely looks like a refusal. Every query beneath
it still runs under RLS, because a layout check is a routing decision, not a
security boundary.

Metrics are aggregated in Postgres by `platform_metrics()` and the error feed
unions three real tables (failed CRM webhooks, unprocessable payment events,
failed dispatches). Nothing is summed in the browser.

**Provisioning is transactional where it can be.** `provision_tenant()` creates
the restaurant, its settings and the onboarding outbox row in one statement,
with the $1.00 platform fee **on by default** — opting out should be a decision
someone makes, not an oversight. The owner needs an auth user, which only the
admin API can create, so that step lives in the route: if it fails, the tenant
is deleted rather than left with nobody able to reach it.

**Impersonation issues no second identity.** The super admin keeps their own
session throughout; a signed, one-hour cookie only says *which* tenant the
console should scope to. That is precisely what keeps the trail honest — every
write during impersonation still records the administrator's `user_id`, and
middleware sets `x-impersonated-tenant`, which `fn_audit_log()` reads to set
`audit_logs.impersonated`. A persistent banner names the target and exits in
one tap.

## The webhook outbox actually drains

`webhook_events` rows are enqueued inside the transaction that writes the thing
they describe. `drainWebhookEvents()` runs immediately after an enqueue, and
`POST /api/admin/webhooks/drain` is exposed for a scheduler (super admin, or
`Authorization: Bearer $CRON_SECRET`). Retries back off exponentially to an
hour and abandon at `max_attempts`.

`vercel.json` schedules the drain. **The schedule is tier-dependent:** Vercel
Hobby permits one cron invocation per day and rejects anything more frequent
at deploy time, so it is set to `0 0 * * *`. On Pro, change it to `*/5 * * * *`
— every five minutes is ample, since the drain also runs inline immediately
after each enqueue and the cron is only the retry path.

> **What daily retries mean in practice:** a CRM webhook that fails at 9am is
> not retried until midnight. Orders are unaffected (the outbox is written in
> the same transaction as the order), but a restaurant's CRM could be a day
> behind after an outage. Move to Pro and `*/5 * * * *` before that matters.

> Hobby is also licensed for non-commercial use only. Running a paid SaaS on
> it is a plan violation regardless of whether the crons work.

## Deploying

The platform IS its subdomains, so a wildcard domain is not optional. It
cannot run on a `*.vercel.app` URL: `admin.<project>.vercel.app` resolves,
but Vercel's `*.vercel.app` certificate does not cover second-level
subdomains, so TLS fails before a request is ever made.

### DNS

Two records, at whichever provider holds the zone (`vardros.com` is on
IONOS nameservers, so Vercel cannot create these itself):

| Type | Name | Value |
| --- | --- | --- |
| A | `order` | `76.76.21.21` |
| A | `*.order` | `76.76.21.21` |

The wildcard is what serves every tenant storefront. Without it only the
apex resolves, and the apex immediately redirects to `admin.` — so nothing
is reachable.

Vercel verifies automatically once the records propagate and then issues
certificates, including for the wildcard.

### Environment

`NEXT_PUBLIC_ROOT_DOMAIN` is inlined into the client bundle at build time,
so changing it requires a **redeploy**, not just an env update.

> **Do not put placeholder values in the Stripe keys.** The code checks
> whether they are present, not whether they are real: a fake
> `STRIPE_SECRET_KEY` turns a clear "missing environment variable" at boot
> into an authentication failure deep inside a customer's checkout, after
> the cart has been priced. Leave them unset until you have live keys —
> everything except checkout and the payment webhook works without them.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in Supabase + gateway credentials
npm run db:start               # local Supabase (ports 553xx)
npm run db:reset               # apply migrations
npm run db:types               # regenerate src/types/supabase.ts
npm run dev
```

Local hosts work without editing `/etc/hosts`:
`admin.localhost:3000`, `app.localhost:3000`, `joes.localhost:3000`.

## Testing

```bash
npm test          # vitest — host/routing units
npm run test:sql  # resets the local DB and runs supabase/tests/*.sql
npm run typecheck
npm run build
```

The SQL suites are real regression tests, not smoke checks: each negative case
raises `FAIL: ...` (errcode `P0001`), which no handler catches, so a regression
aborts the run under `ON_ERROR_STOP` and the runner exits non-zero.

## Types

`src/types/supabase.ts` is **generated** — never hand-edit it, and never import
it directly. `src/types/database.ts` is the single vocabulary the application
speaks: row aliases, composite read models, cart/pricing, payment split,
dispatch, ESC/POS, and GHL payloads. Import from there.

## Layout

```
middleware.ts                     host -> surface routing, session refresh
src/lib/tenancy/host.ts           pure host parsing (unit-tested)
src/types/database.ts             the application's vocabulary
src/types/supabase.ts             GENERATED from the live schema
supabase/migrations/              ordered schema; together they are the init script
supabase/tests/                   SQL regression suites
scripts/run-sql-tests.sh          reset + run every suite
```
