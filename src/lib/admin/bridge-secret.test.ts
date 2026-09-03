import { describe, expect, it } from 'vitest';
import { bearerToken, secretMatches } from './bridge-secret';

const GOOD = 'a'.repeat(48);

describe('bridge secret comparison', () => {
  it('accepts only an exact match', () => {
    expect(secretMatches(GOOD, GOOD)).toBe(true);
    expect(secretMatches(GOOD + 'x', GOOD)).toBe(false);
    expect(secretMatches(GOOD.slice(0, -1), GOOD)).toBe(false);
    expect(secretMatches(GOOD.replace(/a$/, 'b'), GOOD)).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    // The failure a missing-env bug would otherwise cause is "everyone is
    // authorised". An unset secret must disable the machine path instead.
    for (const expected of [undefined, '', '   ']) {
      expect(secretMatches(GOOD, expected)).toBe(false);
      expect(secretMatches('', expected)).toBe(false);
      expect(secretMatches(null, expected)).toBe(false);
    }
  });

  it('refuses a secret too short to be worth anything', () => {
    // An operator who sets PROVISION_BRIDGE_SECRET=test should find out now.
    expect(secretMatches('test', 'test')).toBe(false);
    expect(secretMatches('a'.repeat(31), 'a'.repeat(31))).toBe(false);
    expect(secretMatches('a'.repeat(32), 'a'.repeat(32))).toBe(true);
  });

  it('never throws on a length mismatch', () => {
    // timingSafeEqual throws when buffers differ in length, which would turn a
    // wrong-length guess into a 500 and a timing signal.
    expect(() => secretMatches('x', GOOD)).not.toThrow();
    expect(() => secretMatches('x'.repeat(4096), GOOD)).not.toThrow();
    expect(secretMatches('x'.repeat(4096), GOOD)).toBe(false);
  });

  it('ignores surrounding whitespace on both sides', () => {
    expect(secretMatches(`  ${GOOD}  `, GOOD)).toBe(true);
    expect(secretMatches(GOOD, `  ${GOOD}  `)).toBe(true);
  });
});

describe('bearerToken', () => {
  it('reads the token, and nothing else', () => {
    expect(bearerToken(`Bearer ${GOOD}`)).toBe(GOOD);
    expect(bearerToken(`bearer ${GOOD}`)).toBe(GOOD);
    expect(bearerToken(`  Bearer   ${GOOD}  `)).toBe(GOOD);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken(GOOD)).toBeNull();
    expect(bearerToken(`Basic ${GOOD}`)).toBeNull();
  });
});
