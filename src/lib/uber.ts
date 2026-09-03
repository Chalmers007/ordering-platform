import 'server-only';
import { uberApiBase } from './uber-env';

/**
 * Uber Direct.
 *
 * Two credential scopes, deliberately kept apart:
 *   * the OAuth client id/secret are the PLATFORM's, held in env — one
 *     Uber Direct account fronts every restaurant;
 *   * `customer_id` is per restaurant and lives in `tenant_secrets`,
 *     because it identifies which merchant a delivery is billed to.
 *
 * Nothing here is exported to a browser. The provider's identity, its
 * tokens and its job ids stay on the server; what reaches a customer is
 * the normalised row in `deliveries`.
 */

const AUTH_URL = 'https://login.uber.com/oauth/v2/token';
export {
  uberApiBase,
  uberApiBaseIsExplicit,
  uberEnvironment,
  UBER_SANDBOX_BASE,
  UBER_PRODUCTION_BASE,
} from './uber-env';

export class UberDirectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UberDirectError';
  }
}

// ---------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

/** Test seam, and the way a rotated secret takes effect without a restart. */
export function __resetUberTokenCache(): void {
  cached = null;
}

/**
 * client_credentials, cached until shortly before expiry.
 *
 * The 60-second shave matters: a token that expires mid-flight turns a
 * dispatch into a 401 and an order nobody is delivering.
 */
/**
 * One uncached token request, for diagnosis only.
 *
 * `unauthorized_client` means the server recognises the client but will
 * not issue it this grant. Two causes are indistinguishable from outside:
 * the app is genuinely not provisioned for client_credentials, or it
 * expects its credentials presented the other way.
 *
 * OAuth 2.0 defines two client authentication methods. `client_secret_post`
 * puts the id and secret in the form body; `client_secret_basic` puts them
 * in an HTTP Basic header. A server configured for one rejects the other,
 * and the rejection looks identical to a permissions problem. We only ever
 * tried the first, so this probes both before anyone goes to Uber support
 * with a question we could have answered ourselves.
 */
export async function probeUberScope(
  scope: string,
  auth: 'body' | 'basic' = 'body',
): Promise<{ ok: boolean; status: number; code: string }> {
  const clientId = process.env.UBER_DIRECT_CLIENT_ID?.trim();
  const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { ok: false, status: 0, code: 'credentials_missing' };

  const params: Record<string, string> = { grant_type: 'client_credentials' };
  // An empty scope is a legitimate probe: it asks the server for whatever
  // the app is granted by default.
  if (scope) params.scope = scope;

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (auth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    params.client_id = clientId;
    params.client_secret = clientSecret;
  }

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers,
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return { ok: true, status: response.status, code: 'granted' };

    let code = 'unknown_error';
    try {
      const parsed = (await response.json()) as { error?: string };
      if (typeof parsed.error === 'string') code = parsed.error;
    } catch {
      // Non-JSON; the status carries the signal.
    }
    return { ok: false, status: response.status, code };
  } catch (error) {
    return { ok: false, status: 0, code: error instanceof Error ? error.message : 'request_failed' };
  }
}

export async function getUberAccessToken(now: number = Date.now()): Promise<string> {
  if (cached && cached.expiresAt > now) return cached.token;

  const clientId = process.env.UBER_DIRECT_CLIENT_ID?.trim();
  const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new UberDirectError(
      'Uber Direct is not configured on this deployment (UBER_DIRECT_CLIENT_ID / _SECRET)',
      500,
      false,
    );
  }

  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      // Scope differs by account type: Uber Direct apps are granted
      // `direct.organizations`, while `eats.deliveries` belongs to Uber
      // Eats marketplace integrations. Getting it wrong returns
      // invalid_scope with otherwise-valid credentials, which reads like a
      // credential problem and is not one.
      scope: process.env.UBER_DIRECT_SCOPE?.trim() || 'direct.organizations',
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // The body can echo the client_secret back in an error, so it is never
    // surfaced wholesale. The OAuth `error` field is a fixed code
    // (invalid_client, invalid_scope, unauthorized_client) and carries no
    // secret — and it is the difference between "wrong password" and
    // "wrong scope", which is worth knowing.
    let code = 'unknown_error';
    try {
      const parsed = (await response.json()) as { error?: string; error_description?: string };
      if (typeof parsed.error === 'string') code = parsed.error;
    } catch {
      // Non-JSON response; the status alone will have to do.
    }

    throw new UberDirectError(
      `Courier authentication failed (HTTP ${response.status}: ${code})`,
      response.status,
      response.status >= 500,
    );
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new UberDirectError('Courier returned no access token', 502, true);
  }

  cached = {
    token: body.access_token,
    expiresAt: now + Math.max(0, (body.expires_in ?? 2592000) - 60) * 1000,
  };
  return cached.token;
}

// ---------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------

async function call<T>(path: string, body: unknown): Promise<T> {
  const token = await getUberAccessToken();

  const response = await fetch(`${uberApiBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();

  if (!response.ok) {
    // Logged, not returned: an upstream error message would name the
    // courier to whoever triggered the request.
    console.error('uber direct call failed', path, response.status, text.slice(0, 500));

    let message = 'The courier could not take this delivery';
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string };
      if (parsed.code === 'customer_not_found') message = 'This restaurant is not set up with the courier';
      else if (parsed.code === 'address_undeliverable') message = 'That address is outside the delivery area';
      else if (parsed.code === 'no_couriers_available') message = 'No couriers are available right now';
    } catch {
      // Non-JSON error; the generic message stands.
    }

    throw new UberDirectError(message, response.status, response.status >= 500 || response.status === 429);
  }

  return JSON.parse(text) as T;
}

export type UberAddress = {
  street_address: string[];
  city: string;
  state: string;
  zip_code: string;
  country: string;
};

export type QuoteRequest = {
  pickup_address: string;
  dropoff_address: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  dropoff_latitude?: number;
  dropoff_longitude?: number;
  pickup_ready_dt?: string;
  manifest_total_value: number;
};

export type UberQuote = {
  id: string;
  fee: number;
  currency: string;
  dropoff_eta: string;
  duration: number;
  expires: string;
};

/** A quote is required before a delivery and is short-lived — request it
 *  immediately before dispatching, never cache it. */
export async function createDeliveryQuote(
  customerId: string,
  request: QuoteRequest,
): Promise<UberQuote> {
  return call<UberQuote>(`/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`, request);
}

export type DeliveryRequest = {
  quote_id?: string;
  pickup_name: string;
  pickup_address: string;
  pickup_phone_number: string;
  pickup_business_name?: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  dropoff_name: string;
  dropoff_address: string;
  dropoff_phone_number: string;
  dropoff_latitude?: number;
  dropoff_longitude?: number;
  dropoff_notes?: string;
  manifest_items: {
    name: string;
    quantity: number;
    size: 'small' | 'medium' | 'large' | 'xlarge';
  }[];
  manifest_total_value: number;
  external_id?: string;
  pickup_ready_dt?: string;
};

export type UberDelivery = {
  id: string;
  status: string;
  tracking_url?: string;
  dropoff_eta?: string;
  courier?: { name?: string; phone_number?: string; location?: { lat: number; lng: number } };
};

export async function dispatchDelivery(
  customerId: string,
  request: DeliveryRequest,
): Promise<UberDelivery> {
  return call<UberDelivery>(`/v1/customers/${encodeURIComponent(customerId)}/deliveries`, request);
}

/** @deprecated Prefer the domain-specific `dispatchDelivery` name. */
export const createDelivery = dispatchDelivery;

// Status mapping and fee conversion live outside this module's
// `server-only` boundary so they can be unit-tested.
export { mapUberStatus, quoteFeeCents, type DeliveryStatusValue } from './uber-status';


/**
 * Credential shape, with no credential content.
 *
 * Reports only lengths and whether the value carries surrounding
 * whitespace — a trailing newline pasted through a dashboard fails
 * authentication in a way indistinguishable from a wrong secret, and it
 * is the cheapest cause to eliminate.
 */
export function uberCredentialShape(): Record<string, unknown> {
  const rawId = process.env.UBER_DIRECT_CLIENT_ID ?? '';
  const rawSecret = process.env.UBER_DIRECT_CLIENT_SECRET ?? '';
  return {
    clientIdLength: rawId.trim().length,
    clientSecretLength: rawSecret.trim().length,
    clientIdHadWhitespace: rawId !== rawId.trim(),
    clientSecretHadWhitespace: rawSecret !== rawSecret.trim(),
    // Uber client ids are opaque strings; a value that still looks like a
    // dashboard label ("Client ID", a quoted value) is a paste error.
    clientIdLooksQuoted: /^["']|["']$/.test(rawId.trim()),
    clientSecretLooksQuoted: /^["']|["']$/.test(rawSecret.trim()),
  };
}


/**
 * The exact serialized token-request body, with the secret redacted.
 *
 * Encoding questions ("are we form-encoding correctly?", "is the scope
 * serialized right?") are answerable by looking, not by reasoning — so
 * this shows the literal bytes rather than describing them. The secret is
 * replaced by its length; the client id is shown as a prefix only.
 */
export function uberTokenRequestPreview(): Record<string, string> {
  const clientId = process.env.UBER_DIRECT_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET?.trim() ?? '';

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: process.env.UBER_DIRECT_SCOPE?.trim() || 'direct.organizations',
  }).toString();

  return {
    url: AUTH_URL,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    body: body
      .replace(encodeURIComponent(clientSecret), `<redacted:${clientSecret.length}>`)
      .replace(encodeURIComponent(clientId), `${clientId.slice(0, 6)}...<${clientId.length}>`),
  };
}
