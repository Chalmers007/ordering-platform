import 'server-only';

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
const API_BASE = process.env.UBER_DIRECT_API_BASE ?? 'https://api.uber.com';

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
export async function getUberAccessToken(now: number = Date.now()): Promise<string> {
  if (cached && cached.expiresAt > now) return cached.token;

  const clientId = process.env.UBER_DIRECT_CLIENT_ID;
  const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET;

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
      scope: 'eats.deliveries',
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // The body can contain the client_secret echoed back in an error;
    // never surface it.
    throw new UberDirectError('Could not authenticate with the courier', response.status, response.status >= 500);
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

  const response = await fetch(`${API_BASE}${path}`, {
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
