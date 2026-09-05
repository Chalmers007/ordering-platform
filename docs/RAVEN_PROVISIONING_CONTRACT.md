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
lowercase hexadecimal `source_payload_hash`. `menu_content` is an optional
server-to-server extension and is required for a first staging request.

## Response

The response contains `request_id`, source and identity fields,
`ordering_tenant_id`, `preview_id`, `claim_url`, `preview_url`,
`provisioning_status`, `expires_at`, `retryable`, `error_code`, and
`error_message`.

Idempotency is enforced by unique `(source_system, raven_prospect_id)` and
`(source_system, idempotency_key)` constraints. Google Place ID and normalized
business name/address also have unique source-scoped constraints. A duplicate
request returns the stored result; a conflicting identity returns a permanent
conflict. Provisioning remains `pending_claim` and menu verification remains a
separate owner action.
