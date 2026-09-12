import { describe, expect, it } from 'vitest';
import { declineFeedback, transitionFeedback } from './action-feedback';

describe('KDS owner action feedback', () => {
  it('names each accepted lifecycle step', () => {
    expect(transitionFeedback('confirmed')).toBe('Order accepted');
    expect(transitionFeedback('preparing')).toBe('Order is now preparing');
    expect(transitionFeedback('ready')).toBe('Order marked ready');
    expect(transitionFeedback('completed')).toBe('Order completed');
  });

  it('distinguishes declining an incoming order from cancelling later work', () => {
    expect(declineFeedback('paid')).toBe('Order declined');
    expect(declineFeedback('confirmed')).toBe('Order declined');
    expect(declineFeedback('preparing')).toBe('Order cancelled');
  });
});
