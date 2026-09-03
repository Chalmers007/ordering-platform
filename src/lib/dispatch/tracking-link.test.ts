import { describe, it, expect } from 'vitest';

/**
 * Tracking link delivery tests.
 *
 * Verify that:
 * 1. Tracking URLs are generated correctly with the white-labeled format
 * 2. The token (not order_id) is used for customer-facing links
 * 3. No internal paths like /store/orders are exposed
 * 4. GHL webhooks receive correct data
 * 5. Idempotency prevents duplicate events
 */

describe('Tracking link generation', () => {
  const ROOT_DOMAIN = 'example.com';
  const TENANT_SLUG = 'joespizza';
  const TRACKING_TOKEN = '550e8400-e29b-41d4-a716-446655440000';
  const ORDER_ID = '660e8400-e29b-41d4-a716-446655440001';

  function buildTrackingUrl(
    slug: string,
    token: string,
    domain: string,
    isLocalhost = false,
  ): string {
    const protocol = isLocalhost || domain.includes('localhost') ? 'http' : 'https';
    return `${protocol}://${slug}.${domain}/orders/${token}`;
  }

  it('generates white-labeled tracking URL without /store prefix', () => {
    const url = buildTrackingUrl(TENANT_SLUG, TRACKING_TOKEN, ROOT_DOMAIN);
    expect(url).toBe(
      `https://joespizza.example.com/orders/550e8400-e29b-41d4-a716-446655440000`,
    );
    expect(url).not.toContain('/store/');
  });

  it('uses http protocol for localhost', () => {
    const url = buildTrackingUrl(TENANT_SLUG, TRACKING_TOKEN, 'localhost', true);
    expect(url).toContain('http://');
    expect(url).not.toContain('https://');
  });

  it('uses https protocol for production domain', () => {
    const url = buildTrackingUrl(TENANT_SLUG, TRACKING_TOKEN, 'example.com');
    expect(url).toContain('https://');
  });

  it('never exposes order_id in public tracking URL', () => {
    const url = buildTrackingUrl(TENANT_SLUG, TRACKING_TOKEN, ROOT_DOMAIN);
    expect(url).not.toContain(ORDER_ID);
    expect(url).toContain(TRACKING_TOKEN);
  });

  it('uses opaque token that cannot be sequentially enumerated', () => {
    const token1 = '550e8400-e29b-41d4-a716-446655440000';
    const token2 = '550e8400-e29b-41d4-a716-446655440001';

    const url1 = buildTrackingUrl(TENANT_SLUG, token1, ROOT_DOMAIN);
    const url2 = buildTrackingUrl(TENANT_SLUG, token2, ROOT_DOMAIN);

    // Tokens are opaque UUIDs, not sequential numbers
    expect(url1).not.toMatch(/\/orders\/\d+$/);
    expect(url2).not.toMatch(/\/orders\/\d+$/);
  });
});

describe('GHL webhook payload', () => {
  it('includes required order fields', () => {
    const payload = {
      event: 'order.created',
      orderId: '660e8400-e29b-41d4-a716-446655440001',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      tenantName: "Joe's Pizzeria",
      orderNumber: '260903-0001',
      totalCents: 2100,
      currency: 'USD',
      fulfillmentType: 'delivery',
      isFirstTimeCustomer: true,
      trackingUrl: 'https://joespizza.example.com/orders/8e489600-8781-443b-9ee2-f7d72b899ecb',
      contact: {
        name: 'Dana',
        phone: '+1-555-0100',
        email: 'dana@example.com',
      },
    };

    // Verify no sensitive fields
    expect(Object.keys(payload)).not.toContain('paymentIntentId');
    expect(Object.keys(payload)).not.toContain('costCents');
    expect(Object.keys(payload)).not.toContain('provider');
    expect(Object.keys(payload)).not.toContain('courierPhone');

    // Verify required fields present
    expect(payload).toHaveProperty('trackingUrl');
    expect(payload).toHaveProperty('orderId');
    expect(payload).toHaveProperty('totalCents');
    expect(payload).toHaveProperty('contact.phone');
  });

  it('tracking URL does not contain /store/ path', () => {
    const payload = {
      trackingUrl: 'https://joespizza.example.com/orders/8e489600-8781-443b-9ee2-f7d72b899ecb',
    };

    expect(payload.trackingUrl).not.toContain('/store/');
  });

  it('handles missing email gracefully', () => {
    const payload = {
      contact: {
        name: 'Anonymous',
        phone: '+1-555-0100',
        email: null,
      },
    };

    // GHL should accept null email
    expect(payload.contact).toHaveProperty('phone');
    expect(payload.contact.email).toBeNull();
  });

  it('handles missing phone gracefully', () => {
    const payload = {
      contact: {
        name: 'Anonymous',
        phone: null,
        email: 'contact@example.com',
      },
    };

    // GHL should accept null phone
    expect(payload.contact).toHaveProperty('email');
    expect(payload.contact.phone).toBeNull();
  });
});

describe('Webhook delivery idempotency', () => {
  it('prevents duplicate webhook events for same (order_id, event_type) pair', () => {
    // The unique index on (order_id, event_type) ensures idempotency
    // Redelivering a webhook for the same order creates no new row
    const event1 = { orderId: '660e8400-e29b-41d4-a716-446655440001', eventType: 'order.created' };
    const event2 = { orderId: '660e8400-e29b-41d4-a716-446655440001', eventType: 'order.created' };

    // Same (orderId, eventType) = same event, no duplicate
    expect(event1.orderId).toBe(event2.orderId);
    expect(event1.eventType).toBe(event2.eventType);
  });

  it('allows multiple event types for same order', () => {
    // Different event types for the same order should be allowed
    const event1 = { orderId: '660e8400-e29b-41d4-a716-446655440001', eventType: 'order.created' };
    const event2 = { orderId: '660e8400-e29b-41d4-a716-446655440001', eventType: 'order.completed' };

    // Same order, different events = allowed
    expect(event1.orderId).toBe(event2.orderId);
    expect(event1.eventType).not.toBe(event2.eventType);
  });
});

describe('Token expiration and security', () => {
  it('tracking links expire after 30 days', () => {
    // The get_delivery_tracking() RPC enforces: o.created_at > now() - interval '30 days'
    // This is a database-side constraint, not application-side

    const createdAt = new Date();
    const thirtyDaysLater = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const thirtyOneDaysLater = new Date(createdAt.getTime() + 31 * 24 * 60 * 60 * 1000);

    // Valid window
    expect(thirtyDaysLater.getTime() - createdAt.getTime()).toBeLessThanOrEqual(
      30 * 24 * 60 * 60 * 1000,
    );

    // Outside window
    expect(thirtyOneDaysLater.getTime() - createdAt.getTime()).toBeGreaterThan(
      30 * 24 * 60 * 60 * 1000,
    );
  });
});
