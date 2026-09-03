import 'server-only';
import { requireSuperAdmin } from './guard';
import { bearerToken, secretMatches } from './bridge-secret';

/**
 * Who may call the provisioning bridge.
 *
 * The dashboard reaches it with a super-admin session. vardr-os cannot: it is
 * another service on another host with no cookie, so it presents a shared
 * secret instead. See bridge-secret.ts for how that secret is compared and why
 * an unset one disables the machine path rather than opening it.
 */
export type BridgeCaller =
  | { ok: true; via: 'session' | 'secret' }
  | { ok: false; status: 401 | 403; error: string };

export async function requireBridgeCaller(request: Request): Promise<BridgeCaller> {
  const presented = bearerToken(request.headers.get('authorization'));
  if (presented && secretMatches(presented, process.env.PROVISION_BRIDGE_SECRET)) {
    return { ok: true, via: 'secret' };
  }

  // A wrong secret is 403, not 401: the caller identified itself as a machine
  // and was refused, and telling it to "sign in" sends it round a loop.
  if (presented) return { ok: false, status: 403, error: 'Forbidden' };

  const guard = await requireSuperAdmin();
  if (guard.ok) return { ok: true, via: 'session' };
  return guard.reason === 'unauthenticated'
    ? { ok: false, status: 401, error: 'Not signed in' }
    : { ok: false, status: 403, error: 'Forbidden' };
}
