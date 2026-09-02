import { describe, expect, it } from 'vitest';
import {
  IMPERSONATION_TTL_MS,
  signImpersonationToken,
  verifyImpersonationToken,
  type ImpersonationClaims,
} from './impersonation';

const SECRET = 'a-server-side-signing-secret';
const OTHER_SECRET = 'an-attackers-guess';

const claims: ImpersonationClaims = {
  sid: '99999999-0000-0000-0000-000000000001',
  tenantId: '11111111-1111-1111-1111-111111111111',
  adminId: '00000000-0000-0000-0000-0000000000a1',
  iat: Date.UTC(2026, 8, 2, 12, 0, 0),
};

const at = (offsetMs: number) => claims.iat + offsetMs;

describe('impersonation token', () => {
  it('round-trips the claims', async () => {
    const token = await signImpersonationToken(claims, SECRET);
    await expect(verifyImpersonationToken(token, SECRET, at(1000))).resolves.toEqual(claims);
  });

  it('keeps the administrator identity, not the tenant identity', async () => {
    // This is what makes the audit trail honest: the token names who is
    // looking, and the super admin's own session is what performs writes.
    const token = await signImpersonationToken(claims, SECRET);
    const verified = await verifyImpersonationToken(token, SECRET, at(1000));

    expect(verified?.adminId).toBe('00000000-0000-0000-0000-0000000000a1');
    expect(verified?.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(verified?.adminId).not.toBe(verified?.tenantId);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = await signImpersonationToken(claims, OTHER_SECRET);
    await expect(verifyImpersonationToken(forged, SECRET, at(1000))).resolves.toBeNull();
  });

  it('rejects a payload edited after signing', async () => {
    // Swapping the tenant in the body must invalidate the signature —
    // otherwise a stale token becomes a key to any restaurant.
    const token = await signImpersonationToken(claims, SECRET);
    const [, signature] = token.split('.');
    const tampered = { ...claims, tenantId: '22222222-2222-2222-2222-222222222222' };
    const body = btoa(JSON.stringify(tampered))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await expect(
      verifyImpersonationToken(`${body}.${signature}`, SECRET, at(1000)),
    ).resolves.toBeNull();
  });

  it('expires after the TTL', async () => {
    const token = await signImpersonationToken(claims, SECRET);
    await expect(
      verifyImpersonationToken(token, SECRET, at(IMPERSONATION_TTL_MS - 1000)),
    ).resolves.toEqual(claims);
    await expect(
      verifyImpersonationToken(token, SECRET, at(IMPERSONATION_TTL_MS + 1000)),
    ).resolves.toBeNull();
  });

  it('rejects a token issued in the future', async () => {
    // A hand-rolled iat must not be able to extend the window.
    const future = await signImpersonationToken({ ...claims, iat: at(10 * 60_000) }, SECRET);
    await expect(verifyImpersonationToken(future, SECRET, claims.iat)).resolves.toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    for (const value of ['', 'not-a-token', 'a.b.c', '....', undefined, null]) {
      await expect(verifyImpersonationToken(value, SECRET)).resolves.toBeNull();
    }
  });

  it('rejects a validly signed token that is missing claims', async () => {
    const partial = await signImpersonationToken(
      { sid: 'x', tenantId: 'y' } as unknown as ImpersonationClaims,
      SECRET,
    );
    await expect(verifyImpersonationToken(partial, SECRET)).resolves.toBeNull();
  });

  it('refuses to verify without a secret', async () => {
    const token = await signImpersonationToken(claims, SECRET);
    await expect(verifyImpersonationToken(token, '')).resolves.toBeNull();
  });

  it('refuses to sign without a secret', async () => {
    await expect(signImpersonationToken(claims, '')).rejects.toThrow(/signing secret/);
  });
});
