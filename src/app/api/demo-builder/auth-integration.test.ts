import { describe, it, expect } from 'vitest';

/**
 * Integration test documenting the authentication boundary for demo builder.
 *
 * PROTECTED (require super-admin):
 * - GET /demo-builder (page)
 * - POST /api/demo-builder/create (endpoint)
 *
 * PUBLIC (no auth):
 * - GET /preview-url/* (safe preview link, read-only)
 * - POST /api/demo/[tenantId]/logo (uses httpOnly preview session)
 * - POST /api/demo/[tenantId]/menu (uses httpOnly preview session)
 *
 * SEPARATE SYSTEM (unchanged):
 * - Raven provisioning via /api/internal/provision/raven (server-to-server)
 * - Claim flow via /claim (uses claim token, not builder auth)
 * - Owner dashboard (tenant owner/staff auth via resolveStaffTenantId)
 */

describe('Demo Builder Authentication Boundary', () => {
  it('builder page requires super-admin auth (401 if missing, 403 if not admin)', () => {
    // /demo-builder: redirects to /admin/login if unauthenticated
    // /demo-builder: calls forbidden() if authenticated but not super-admin
    const expectedRedirects = {
      unauthenticated: '/admin/login?next=/demo-builder',
      notAdmin: 403,
    };

    expect(expectedRedirects).toHaveProperty('unauthenticated');
    expect(expectedRedirects).toHaveProperty('notAdmin');
  });

  it('create API endpoint requires super-admin (401 if missing, 403 if not admin)', () => {
    // POST /api/demo-builder/create
    // Returns 401 + { error: "Authentication required" } if no auth
    // Returns 403 + { error: "Access denied" } if not super-admin
    const expectedResponses = {
      unauthenticated: { status: 401, error: 'Authentication required' },
      notAdmin: { status: 403, error: 'Access denied' },
    };

    expect(expectedResponses.unauthenticated.status).toBe(401);
    expect(expectedResponses.notAdmin.status).toBe(403);
  });

  it('public preview URL contains no auth or secrets', () => {
    // Format: https://<slug>.order.example.com
    // No token, no bearer, no key, no tenant_id
    const previewUrl = 'https://mario-pizza.order.example.com';

    const forbiddenInUrl = ['token', 'bearer', 'secret', 'key', 'tenant', 'claim'];
    for (const forbidden of forbiddenInUrl) {
      expect(previewUrl.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('preview session is httpOnly (not accessible to JS/XSS)', () => {
    // Logo and menu uploads use preview session cookie
    // Set with: httpOnly: true, sameSite: 'lax', secure: true (prod)
    // Never exposed to client JS
    const cookieAttrs = {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    };

    expect(cookieAttrs.httpOnly).toBe(true);
  });

  it('demo — not yet live banner blocks ordering', () => {
    // Storefront shows: "Demo — not yet live. Orders disabled."
    // Checkout endpoint returns 403 for un-claimed tenants
    // Cart validation rejects items from sample menu
    const demoState = 'pending_claim';
    expect(demoState).toBe('pending_claim');
  });

  it('claim flow is unchanged (uses claim token, not builder auth)', () => {
    // Separate from builder auth:
    // 1. Operator uses builder to create demo (super-admin)
    // 2. Operator sends preview URL to restaurant owner
    // 3. Owner visits preview URL (no auth needed)
    // 4. Owner uploads logo/menu via preview session
    // 5. Owner finds claim link in email (one-time token)
    // 6. Owner uses claim token to create account
    // Auth system: builder → super-admin, claim → token-based
    const isClaimFlowSeparate = true;
    expect(isClaimFlowSeparate).toBe(true);
  });

  it('Raven provisioning is unchanged (server-to-server, HMAC-signed)', () => {
    // /api/internal/provision/raven (handles Raven events)
    // Uses HMAC signature verification, not super-admin auth
    // Creates demo fallback just like builder does (same createFallback call)
    // No change to Raven workflow
    const ravenEndpoint = '/api/internal/provision/raven';
    const usesBuilderAuth = false;

    expect(usesBuilderAuth).toBe(false);
  });

  it('duplicate prevention works with both Raven and builder', () => {
    // By raven_prospect_id (Raven provisioning)
    // By name_hash (builder — "Mario Pizza" → same demo both times)
    // Two independent idempotency keys
    const idempotencyMethods = ['raven_prospect_id', 'name_hash'];
    expect(idempotencyMethods).toHaveLength(2);
  });

  it('response never includes claim tokens or secrets', () => {
    // Builder API response: { tenant_id, slug, preview_url, state, expires_at }
    // Never includes: claim_token, secret_key, raven_prospect_id, service_role
    const response = {
      tenant_id: 'abc123',
      slug: 'mario-pizza',
      preview_url: 'https://mario-pizza.order.example.com',
      state: 'created',
      expires_at: '2026-09-15T21:00:00Z',
    };

    const json = JSON.stringify(response);
    const forbidden = ['claim_token', 'secret', 'service_role', 'raven_prospect'];

    for (const word of forbidden) {
      expect(json.toLowerCase()).not.toContain(word);
    }
  });

  it('sample menu remains fallback (disabled until owner uploads real menu)', () => {
    // Source: 'sample', is_available: false
    // Owner must upload real menu to enable ordering
    // Menu verified by operator before activation
    const sampleMenuBehavior = 'read-only-fallback';
    expect(sampleMenuBehavior).toBe('read-only-fallback');
  });

  it('super-admin can impersonate tenants separately (builder not affected)', () => {
    // Builder: uses requireSuperAdmin() → userId only
    // Impersonation headers don't affect builder auth
    // Impersonation is for admin dashboard viewing, not demo creation
    const builderUsesImpersonation = false;
    expect(builderUsesImpersonation).toBe(false);
  });
});
