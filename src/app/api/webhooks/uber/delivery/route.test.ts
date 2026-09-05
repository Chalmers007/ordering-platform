import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyUberSignature } from '@/lib/uber-signature';

/**
 * The previous version of this file re-implemented the route's status map
 * inline and asserted against its own copy, so it passed while the route
 * it was named after verified no signatures at all. These tests exercise
 * the real verifier, and assert the alias points at the canonical route.
 */

const SECRET = 'a-test-signing-secret';
const BODY = JSON.stringify({ delivery_id: 'del_123', status: 'delivered' });
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('uber webhook signature enforcement', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyUberSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('accepts a digest carrying the sha256= prefix', () => {
    expect(verifyUberSignature(BODY, `sha256=${sign(BODY)}`, SECRET)).toBe(true);
  });

  it('rejects a body that was altered after signing', () => {
    const forged = JSON.stringify({ delivery_id: 'del_123', status: 'delivered', total: 0 });
    expect(verifyUberSignature(forged, sign(BODY), SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyUberSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing signature header rather than passing it through', () => {
    expect(verifyUberSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyUberSignature(BODY, '', SECRET)).toBe(false);
  });

  it('returns false — never throws — on a wrong-length digest', () => {
    expect(() => verifyUberSignature(BODY, 'deadbeef', SECRET)).not.toThrow();
    expect(verifyUberSignature(BODY, 'deadbeef', SECRET)).toBe(false);
  });

  it('rejects when the secret itself is missing, so an unconfigured deploy cannot accept forgeries', () => {
    expect(verifyUberSignature(BODY, sign(BODY), '')).toBe(false);
  });
});

describe('/api/webhooks/uber/delivery alias', () => {
  it('is the same handler as /api/webhooks/uber, not a second implementation', async () => {
    const [alias, canonical] = await Promise.all([import('./route'), import('../route')]);
    expect(alias.POST).toBe(canonical.POST);
  });

  it('does not read the non-existent UBER_WEBHOOK_SECRET', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/process\.env\.UBER_WEBHOOK_SECRET/);
  });
});
