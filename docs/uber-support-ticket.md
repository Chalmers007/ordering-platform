# Uber Developer Support — sandbox app missing scope entitlements

> Fill in the three bracketed values before sending: `<CLIENT_ID>`,
> `<ORG/ACCOUNT NAME>`, `<CONTACT EMAIL>`. Nothing else needs editing.
> The client secret is deliberately absent — never include it.

---

**Subject:** Sandbox Direct app authenticates but has no scopes provisioned — all scope requests return `invalid_scope`

**Product:** Uber Direct (3PL) — Sandbox
**Client ID:** `<CLIENT_ID>`
**Account / Organization:** `<ORG/ACCOUNT NAME>`
**Date observed:** 2026-09-03, 05:33 UTC (reproducible on demand)

---

## Summary

Our sandbox Direct application authenticates successfully against
`sandbox-login.uber.com`, but **every** scope we request is rejected with
`400 invalid_scope`. Requesting **no scope at all** is rejected the same
way. This indicates the application entity has no scope entitlements bound
to it on your backend, rather than a malformed request on our side.

We are asking for `eats.deliveries` and `direct.organizations` to be
attached to the sandbox application above.

## Request we are sending

```
POST https://sandbox-login.uber.com/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

client_id=<CLIENT_ID>&client_secret=<40-char secret, omitted>&grant_type=client_credentials&scope=eats.deliveries
```

Equivalent cURL:

```bash
curl -X POST "https://sandbox-login.uber.com/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "grant_type=client_credentials" \
  -d "scope=eats.deliveries"
```

## Response

```json
HTTP 400
{ "error": "invalid_scope", "error_description": "scope(s) are invalid" }
```

## What we have already ruled out

We would like to save your team the usual first-pass checks. Each of the
following was tested directly, not assumed.

**1. Scope name.** Nine values, all returning `400 invalid_scope`:

| scope requested | result |
| --- | --- |
| `eats.deliveries` | `400 invalid_scope` |
| `direct.organizations` | `400 invalid_scope` |
| `direct.deliveries` | `400 invalid_scope` |
| `delivery` | `400 invalid_scope` |
| `deliveries` | `400 invalid_scope` |
| `eats.store` | `400 invalid_scope` |
| `eats.order` | `400 invalid_scope` |
| `direct` | `400 invalid_scope` |
| *(scope parameter omitted entirely)* | `400 invalid_scope` |

The final row is the key evidence: **a request carrying no `scope`
parameter cannot be rejected on the basis of its scope value.** The
rejection is therefore a property of the application registration, not of
what we asked for.

**2. Client authentication.** Confirmed working. Authenticating the same
credentials against the *production* host returns a different error,
`401 unauthorized_client` with `error_description` "the current
application environment is mismatched with the OAuth server runtime
environment" — which confirms both that the credential pair is valid and
that we are correctly routed to the sandbox OAuth host. Against
`sandbox-login.uber.com` we receive `400 invalid_scope`, i.e. the client
is authenticated and then found to have nothing authorized.

**3. Client authentication method.** Both OAuth 2.0 methods were tried
with identical results: `client_secret_post` (credentials in the form
body) and `client_secret_basic` (HTTP Basic `Authorization` header).

**4. Request encoding.** `Content-Type: application/x-www-form-urlencoded`,
parameters URL-encoded, no surrounding whitespace or quoting in either
credential (verified programmatically: client id 32 characters, client
secret 40 characters, both clean).

**5. Environment routing.** `UBER_DIRECT_API_BASE` is
`https://sandbox-api.uber.com` and the OAuth host is
`https://sandbox-login.uber.com`, so the app environment and the OAuth
server environment match.

## What we are asking for

Please have the engineering team verify the scope entitlements bound to
sandbox application `<CLIENT_ID>` and attach:

- `eats.deliveries`
- `direct.organizations`

If our account is expected to use a different scope name for Direct
sandbox access, please tell us the exact string and we will use it — our
implementation reads the scope from configuration, so no code change is
required on our side.

## Context

We are integrating Uber Direct as the delivery provider for a multi-tenant
restaurant ordering platform. Each restaurant is a separate merchant with
its own `customer_id`; the OAuth credentials above are the platform-level
credentials. We are blocked at sandbox verification and cannot proceed to
production onboarding until token issuance succeeds.

Happy to reproduce on a call or supply further logs.

**Contact:** `<CONTACT EMAIL>`
