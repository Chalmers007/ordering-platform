# Raven → ordering-platform provisioning contract

Endpoint: `POST /api/internal/provision/raven`.

This is a server-only endpoint. It accepts no browser cookies, `Origin`, or
`Referer` and requires a signed request. It never sends email/SMS, writes GHL,
activates a tenant, or accepts a tenant id. The first request must include the
optional `menu_content` extension (raw HTML/text used by the existing parser);
the listed source fields are the stable identity contract.

## Canonical signature

The body is sent exactly as signed. Compute `body_sha256` as lowercase hex
SHA-256 of those bytes. The canonical string is:

```
v1\n{X-Vardr-Source}\n{X-Vardr-Timestamp}\n{X-Vardr-Nonce}\n{X-Vardr-Key-Id}\n{HTTP method}\n{request path}\n{body_sha256}
```

Sign it with HMAC-SHA256 and encode the result as base64url without padding.
The server resolves `X-Vardr-Key-Id` through `RAVEN_PROVISION_KEYS` (JSON key
ring) or the compatibility pair `RAVEN_PROVISION_KEY_ID` and
`RAVEN_PROVISION_SECRET`. Old keys may remain in the ring during rotation.
Comparisons are constant-time. Timestamps must be within five minutes and each
nonce is stored once, so replay and concurrent reuse are rejected.

Required headers are `X-Vardr-Source: raven`, `X-Vardr-Timestamp` (Unix
seconds), `X-Vardr-Nonce`, `X-Vardr-Key-Id`, and `X-Vardr-Signature`.

## Request

The JSON fields are `version: "1"`, `source_system: "raven"`,
`raven_prospect_id`, `idempotency_key`, `event_type`, `occurred_at`,
`google_place_id`, `normalized_business_name`, `normalized_address`,
`normalized_website`, `phone`, `email`, `restaurant_category`, and the
lowercase hexadecimal `source_payload_hash`. A first request must also include
`menu_source_url` (HTTPS), `menu_content`, `menu_content_type`,
`menu_content_sha256`, and `menu_fetched_at`. Supported content types are
`text/html`, `text/plain`, and `application/json`. Content is limited to
500,000 characters, hashed before parsing, and must have been fetched within
24 hours. An idempotent retry returns the stored result without resending the
menu.

## Response

The response contains `request_id`, source and identity fields,
`ordering_tenant_id`, `preview_id`, `claim_url`, `preview_url`,
`provisioning_status`, `expires_at`, `retryable`, `error_code`, and
`error_message`. A `duplicate_identity` refusal additionally carries
`conflicting_field`, naming which key already belonged to someone else.

First provisioning requires a valid, fresh menu object and creates a
`pending_claim` tenant. An idempotent retry returns the stored response without
requiring menu bytes. Transient parser/database failures are `failed` and
retryable; malformed or stale menu data is a permanent `exhausted` failure.
Expired previews are never refreshed by this endpoint and must be regenerated
by the source system before a new request.

## Identity, retries and conflicts

Four unique source-scoped constraints hold a restaurant to one provisioning
record: `(source_system, idempotency_key)`, `(source_system,
raven_prospect_id)`, `(source_system, google_place_id)` where the place id is
present, and `(source_system, normalized_business_name, normalized_address)`.

An incoming request is matched against those keys in that order, and whichever
one matched, a single question settles the outcome: does the stored record
belong to the same `raven_prospect_id`?

**Same prospect — the stored result.** A retry from the prospect that already
owns the record returns that record, with its original `request_id`,
`ordering_tenant_id` and `claim_url`. This holds whether the retry repeats the
original `idempotency_key` or arrives under a new one, and whether or not it
carries menu bytes. Nothing is staged twice and no second row is written.

**A different prospect — `409 duplicate_identity`, permanently.** If the
matched record belongs to another `raven_prospect_id`, the request is refused
with `retryable: false` and `conflicting_field` set to `idempotency_key`,
`raven_prospect_id`, `google_place_id`, or `normalized_identity`. Two Raven
prospects have resolved to one restaurant, which only the source system can
reconcile. The stored record is never mutated, never overwritten, and never
returned to the other prospect — its `claim_url` is an ownership token for a
storefront, and handing it to the wrong prospect would hand over the business.

**Reusing another prospect's idempotency key is a conflict, not a retry.** The
key alone does not establish identity; `raven_prospect_id` does. A request
whose `idempotency_key` matches a record owned by a different prospect is
therefore refused with `409 duplicate_identity` and
`conflicting_field: "idempotency_key"`, rather than being served that record.

The same test governs a lost race. When a concurrent writer commits between
the lookup and the insert, the winner is re-examined the same way: the same
prospect gets the stored result, a different one gets the permanent conflict.

Provisioning remains `pending_claim` and menu verification remains a separate
owner action.
