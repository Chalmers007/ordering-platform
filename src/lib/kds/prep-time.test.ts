import { describe, expect, it } from 'vitest';
import { parsePrepTime, promisedAtFromNow } from './prep-time';

describe('per-order prep time', () => {
  it('accepts whole-minute estimates in the supported range', () => {
    expect(parsePrepTime('0')).toBe(0);
    expect(parsePrepTime(' 35 ')).toBe(35);
    expect(parsePrepTime('240')).toBe(240);
  });

  it('rejects invalid or unsafe estimates', () => {
    expect(parsePrepTime('')).toBeNull();
    expect(parsePrepTime('12.5')).toBeNull();
    expect(parsePrepTime('-1')).toBeNull();
    expect(parsePrepTime('241')).toBeNull();
    expect(parsePrepTime('nope')).toBeNull();
  });

  it('derives a stable promise timestamp from the estimate', () => {
    expect(promisedAtFromNow(20, Date.parse('2026-09-12T12:00:00.000Z'))).toBe(
      '2026-09-12T12:20:00.000Z',
    );
  });
});
