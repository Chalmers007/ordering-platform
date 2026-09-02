import { describe, expect, it } from 'vitest';
import { backoffSeconds } from './backoff';

describe('webhook retry backoff', () => {
  it('grows exponentially from the first attempt', () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(4)).toBe(240);
  });

  it('caps at an hour so a dead endpoint is not hammered forever', () => {
    expect(backoffSeconds(20)).toBe(3600);
    expect(backoffSeconds(1000)).toBe(3600);
  });

  it('never returns a negative or zero delay', () => {
    expect(backoffSeconds(0)).toBeGreaterThan(0);
    expect(backoffSeconds(-5)).toBeGreaterThan(0);
  });
});
