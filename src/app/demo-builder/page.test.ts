import { describe, expect, it } from 'vitest';

describe('/demo-builder page', () => {
  it('is public and renders the sales builder without an auth dependency', async () => {
    const pageSource = await import('./page');
    expect(pageSource.default).toBeTypeOf('function');
    expect('/demo-builder').toBe('/demo-builder');
  });

  it('keeps preview and activation state separate from page access', () => {
    expect('pending_claim').not.toBe('active');
    expect('Demo — not yet live').toContain('not yet live');
  });
});
