/**
 * Impersonation token.
 *
 * No second JWT is minted, and nothing about this grants authority. The
 * super admin keeps their own session for the whole time — which is exactly
 * what keeps the audit trail honest, because every write still records the
 * administrator's `user_id`. RLS already lets a super admin read across
 * tenants; this cookie only says *which* tenant the console should scope
 * itself to.
 *
 * It is signed anyway. A forged cookie is useless to a non-super-admin
 * (RLS still refuses them), but a tamper-evident one means the banner and
 * the audit `impersonated` flag cannot be quietly desynchronised from the
 * session row.
 *
 * Web Crypto rather than node:crypto: this has to verify inside edge
 * middleware as well as in route handlers.
 */

export const IMPERSONATION_COOKIE = 'op_impersonation';

/** Long enough for real support work, short enough that a walked-away
 *  laptop stops being a cross-tenant window. */
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

export type ImpersonationClaims = {
  /** impersonation_sessions.id */
  sid: string;
  /** the tenant being viewed */
  tenantId: string;
  /** the super admin doing the viewing — never replaced by the tenant */
  adminId: string;
  /** issued at, epoch ms */
  iat: number;
};

// --- base64url (no Buffer: this runs on the edge too) -----------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// --- sign / verify -----------------------------------------------------

export async function signImpersonationToken(
  claims: ImpersonationClaims,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error('An impersonation signing secret is required');

  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Returns the claims, or null for anything that is not a currently valid
 * token. Null covers every failure — bad shape, bad signature, expired —
 * on purpose: a caller should never branch on *why* a token was rejected.
 */
export async function verifyImpersonationToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): Promise<ImpersonationClaims | null> {
  if (!token || !secret) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let valid: boolean;
  try {
    // crypto.subtle.verify is constant-time; comparing the strings would
    // not be.
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature) as unknown as ArrayBuffer,
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let claims: ImpersonationClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as ImpersonationClaims;
  } catch {
    return null;
  }

  if (
    typeof claims?.sid !== 'string' ||
    typeof claims?.tenantId !== 'string' ||
    typeof claims?.adminId !== 'string' ||
    typeof claims?.iat !== 'number'
  ) {
    return null;
  }

  // Reject the future as well as the past: a clock-skewed or hand-rolled
  // iat must not extend the window.
  if (claims.iat > now + 60_000) return null;
  if (now - claims.iat > IMPERSONATION_TTL_MS) return null;

  return claims;
}

/**
 * The signing secret.
 *
 * Server-only. Falls back to the service-role key, which is already a
 * required server secret — so impersonation cannot be silently unsigned
 * because someone forgot one more environment variable.
 */
export function impersonationSecret(): string {
  const secret =
    process.env.IMPERSONATION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!secret) {
    throw new Error(
      'Set IMPERSONATION_SECRET (or SUPABASE_SERVICE_ROLE_KEY) to enable impersonation',
    );
  }
  return secret;
}

export const IMPERSONATION_HEADER = 'x-impersonated-tenant';
export const IMPERSONATION_SESSION_HEADER = 'x-impersonation-session';

/**
 * Cookie scope.
 *
 * Impersonation starts on `admin.<root>` but is consumed on `app.<root>`
 * and on tenant storefronts, so a host-only cookie is useless: the browser
 * would never send it anywhere but the console it was issued on. Setting
 * `domain` to the root makes it readable across every surface.
 *
 * The port is stripped because cookie domains cannot carry one — with
 * `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000` an unstripped value is silently
 * rejected and impersonation appears to do nothing.
 */
export function impersonationCookieDomain(): string | undefined {
  const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '').trim().replace(/:\d+$/, '');
  return root || undefined;
}

/** One definition, so DELETE clears exactly what POST set — a cookie
 *  removed with a different domain or path is simply not removed. */
export function impersonationCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  domain?: string;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(impersonationCookieDomain() ? { domain: impersonationCookieDomain() } : {}),
  };
}
