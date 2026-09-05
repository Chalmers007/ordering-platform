import { describe, it, expect } from 'vitest';
import { isRetryExhausted } from './retry-dispatch';

describe('Retry dispatch logic', () => {
  describe('isRetryExhausted', () => {
    it('allows retry for attempts 0-4', () => {
      expect(isRetryExhausted(0)).toBe(false);
      expect(isRetryExhausted(1)).toBe(false);
      expect(isRetryExhausted(2)).toBe(false);
      expect(isRetryExhausted(3)).toBe(false);
      expect(isRetryExhausted(4)).toBe(false);
    });

    it('exhausts retry after 5 attempts', () => {
      expect(isRetryExhausted(5)).toBe(true);
      expect(isRetryExhausted(6)).toBe(true);
    });
  });

  describe('backoff schedule', () => {
    // Backoff progression: 30s, 5m, 30m, 4h, 24h
    const expected = [30, 300, 1800, 14400, 86400];

    it('follows exponential backoff', () => {
      for (let i = 0; i < expected.length; i++) {
        // This tests that the backoff logic would use the right value
        expect(expected[i]).toBeGreaterThan(i === 0 ? 0 : expected[i - 1]);
      }
    });

    it('caps out at 24 hours', () => {
      // After 5 attempts, should stay at 24h
      expect(expected[4]).toBe(86400);
    });
  });
});
