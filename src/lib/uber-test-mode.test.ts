import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The safety flag that decides whether a dispatch books a human.
 *
 * Uber Direct has no separate sandbox host for this account, so this flag
 * — not a URL — is what stands between a test order and a real courier
 * arriving at a real address. It is tested for the fail-safe direction
 * specifically: everything except an explicit 'false' must simulate.
 */

const ORIGINAL = process.env.UBER_DIRECT_TEST_MODE;

async function testModeEnabled(): Promise<boolean> {
  // Re-imported per case: the module reads the variable at call time, but
  // a fresh import keeps these cases independent of evaluation order.
  const mod = await import('./uber');
  return mod.uberTestModeEnabled();
}

beforeEach(() => {
  delete process.env.UBER_DIRECT_TEST_MODE;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.UBER_DIRECT_TEST_MODE;
  else process.env.UBER_DIRECT_TEST_MODE = ORIGINAL;
});

describe('uberTestModeEnabled', () => {
  it('simulates when the variable is unset — an unconfigured deploy must not book a courier', async () => {
    await expect(testModeEnabled()).resolves.toBe(true);
  });

  it("goes live only on the exact string 'false'", async () => {
    process.env.UBER_DIRECT_TEST_MODE = 'false';
    await expect(testModeEnabled()).resolves.toBe(false);
  });

  it("accepts 'FALSE' and ' false ' as the same deliberate choice", async () => {
    process.env.UBER_DIRECT_TEST_MODE = 'FALSE';
    await expect(testModeEnabled()).resolves.toBe(false);
    process.env.UBER_DIRECT_TEST_MODE = '  false  ';
    await expect(testModeEnabled()).resolves.toBe(false);
  });

  it('keeps simulating on any other value, including ones that look falsy', async () => {
    for (const value of ['', 'true', '0', 'no', 'off', 'False ish', 'undefined']) {
      process.env.UBER_DIRECT_TEST_MODE = value;
      await expect(testModeEnabled(), `value: ${JSON.stringify(value)}`).resolves.toBe(true);
    }
  });
});
