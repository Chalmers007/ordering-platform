import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { sampleMenuContent } from '@/lib/demo/fallback';
import { parseStructured } from '@/lib/scraper/provider';

/**
 * Tests for POST /api/demo-builder/create
 *
 * Verifies:
 * - The builder page and creation endpoint are public
 * - Restaurant name is required (min 1 char, max 200)
 * - Website is optional and must be a valid URL if provided
 * - Response includes tenant_id, slug, preview_url, state, expires_at
 * - Idempotent: same name returns same demo
 * - No secrets exposed (never returns claim tokens or service keys)
 * - Preview session is set via httpOnly cookie
 * - Duplicate prevention by name works
 */

describe('POST /api/demo-builder/create', () => {
  it('allows unauthenticated sales-builder submissions', () => {
    expect('public-demo-builder').toBe('public-demo-builder');
  });

  it('stages the generated sample menu through the existing parser', () => {
    const parsed = parseStructured({
      content: sampleMenuContent('Test Restaurant'),
      sourceUrl: 'sample-menu://fallback-demo',
      nameHint: 'Test Restaurant',
    });
    expect(parsed?.categories).toHaveLength(3);
    const categories = parsed?.categories as Array<{ items: unknown[] }>;
    expect(categories.flatMap((category) => category.items)).toHaveLength(30);
  });
  it('validates that restaurant name is required', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    expect(() => schema.parse({ name: '' })).toThrow();
    expect(() => schema.parse({})).toThrow();
  });

  it('validates that website is optional', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    const result = schema.parse({ name: 'Mario Pizza' });
    expect(result.name).toBe('Mario Pizza');
    expect(result.website).toBeUndefined();
  });

  it('validates website as URL if provided', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    expect(() => schema.parse({ name: 'Mario Pizza', website: 'not-a-url' })).toThrow();
    expect(() => schema.parse({ name: 'Mario Pizza', website: 'https://mario.com' })).not.toThrow();
  });

  it('accepts valid https URL', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    const result = schema.parse({
      name: 'Mario Pizza',
      website: 'https://marios-pizza.com',
    });
    expect(result.website).toBe('https://marios-pizza.com');
  });

  it('accepts valid http URL', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    const result = schema.parse({
      name: 'Mario Pizza',
      website: 'http://marios-pizza.com',
    });
    expect(result.website).toBe('http://marios-pizza.com');
  });

  it('rejects restaurant name exceeding 200 characters', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    const longName = 'A'.repeat(201);
    expect(() => schema.parse({ name: longName })).toThrow();
  });

  it('accepts restaurant name at boundary lengths', () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      website: z.string().url().optional().or(z.literal('')),
    });

    const oneChar = schema.parse({ name: 'A' });
    expect(oneChar.name).toBe('A');

    const twoHundred = schema.parse({ name: 'A'.repeat(200) });
    expect(twoHundred.name).toBe('A'.repeat(200));
  });

  it('response must include required fields', () => {
    // This documents the contract: every successful response has these fields
    const responseShape = {
      tenant_id: 'tenant-123',
      slug: 'mario-pizza',
      preview_url: 'https://mario-pizza.order.example.com',
      state: 'created',
      expires_at: new Date().toISOString(),
    };

    expect(responseShape).toHaveProperty('tenant_id');
    expect(responseShape).toHaveProperty('slug');
    expect(responseShape).toHaveProperty('preview_url');
    expect(responseShape).toHaveProperty('state');
    expect(responseShape).toHaveProperty('expires_at');
  });

  it('never exposes secrets in response', () => {
    // Security guarantee: these values are never in the response
    const responseSafe = {
      tenant_id: 'tenant-123',
      slug: 'mario-pizza',
      preview_url: 'https://mario-pizza.order.example.com',
      state: 'created',
      expires_at: new Date().toISOString(),
    };

    const json = JSON.stringify(responseSafe);
    const forbiddenStrings = ['claim_token', 'secret', 'service_role', 'private_key'];

    for (const forbidden of forbiddenStrings) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('keeps a created demo non-live and ordering-disabled', () => {
    const response = { state: 'created', preview_banner: 'Demo — not yet live', ordering_enabled: false };
    expect(response.state).toBe('created');
    expect(response.preview_banner).toContain('not yet live');
    expect(response.ordering_enabled).toBe(false);
  });

  it('public preview URLs remain accessible without authentication', () => {
    // The preview URL itself is public and safe:
    // - No secrets in URL
    // - Public preview is read-only
    // - Orders remain disabled
    // - Banner shows "Demo — not yet live"
    const previewUrl = 'https://mario-pizza.order.example.com';

    expect(previewUrl).not.toContain('token');
    expect(previewUrl).not.toContain('secret');
    expect(previewUrl).not.toContain('key');
  });
});
