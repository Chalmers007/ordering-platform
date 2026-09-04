import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkTenantUberCustomerId } from './actions';
import * as guardModule from './guard';
import * as supabaseModule from '@/lib/supabase/server';

describe('checkTenantUberCustomerId server action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when user is unauthenticated', async () => {
    vi.spyOn(guardModule, 'requireSuperAdmin').mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
    });

    const result = await checkTenantUberCustomerId('vardr-upload-test');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('unauthenticated');
  });

  it('returns error when user is not super admin', async () => {
    vi.spyOn(guardModule, 'requireSuperAdmin').mockResolvedValue({
      ok: false,
      reason: 'forbidden',
    });

    const result = await checkTenantUberCustomerId('vardr-upload-test');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('forbidden');
  });

  it('returns error when tenant not found', async () => {
    vi.spyOn(guardModule, 'requireSuperAdmin').mockResolvedValue({
      ok: true,
      context: {
        userId: 'test-user',
        impersonatedTenantId: null,
        impersonationSessionId: null,
      },
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' },
            }),
          }),
        }),
      }),
    };

    vi.spyOn(supabaseModule, 'createServiceClient').mockReturnValue(
      mockSupabase as any,
    );

    const result = await checkTenantUberCustomerId('nonexistent');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Tenant not found');
  });

  it('returns true when tenant has uber_customer_id', async () => {
    vi.spyOn(guardModule, 'requireSuperAdmin').mockResolvedValue({
      ok: true,
      context: {
        userId: 'test-user',
        impersonatedTenantId: null,
        impersonationSessionId: null,
      },
    });

    const mockSupabase = {
      from: vi.fn((table) => {
        if (table === 'tenants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'tenant-123' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'tenant_secrets') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValueOnce({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { value: 'uber-customer-id-xyz' },
                    }),
                  }),
                })
                .mockReturnValueOnce({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { value: 'uber-customer-id-xyz' },
                  }),
                }),
            }),
          };
        }
      }),
    };

    vi.spyOn(supabaseModule, 'createServiceClient').mockReturnValue(
      mockSupabase as any,
    );

    const result = await checkTenantUberCustomerId('vardr-upload-test');

    expect(result.ok).toBe(true);
    expect(result.hasUberCustomerId).toBe(true);
  });

  it('returns false when tenant lacks uber_customer_id', async () => {
    vi.spyOn(guardModule, 'requireSuperAdmin').mockResolvedValue({
      ok: true,
      context: {
        userId: 'test-user',
        impersonatedTenantId: null,
        impersonationSessionId: null,
      },
    });

    const mockSupabase = {
      from: vi.fn((table) => {
        if (table === 'tenants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'tenant-456' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'tenant_secrets') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValueOnce({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                    }),
                  }),
                })
                .mockReturnValueOnce({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                  }),
                }),
            }),
          };
        }
      }),
    };

    vi.spyOn(supabaseModule, 'createServiceClient').mockReturnValue(
      mockSupabase as any,
    );

    const result = await checkTenantUberCustomerId('vardr-upload-test');

    expect(result.ok).toBe(true);
    expect(result.hasUberCustomerId).toBe(false);
  });
});
