import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { autoDispatch } from './auto-dispatch';
import { createServiceClient } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/uber', () => ({
  UberDirectError: class UberDirectError extends Error {
    constructor(message: string, public status: number, public retryable: boolean) {
      super(message);
    }
  },
  createDeliveryQuote: vi.fn(),
  dispatchDelivery: vi.fn(),
  mapUberStatus: vi.fn((status) => status),
}));

describe('autoDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not dispatched when order not found', async () => {
    const mockService = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          })),
        })),
      })),
    };

    (createServiceClient as any).mockReturnValue(mockService);

    const result = await autoDispatch('non-existent-id');
    expect(result.dispatched).toBe(false);
    if (!result.dispatched) {
      expect(result.reason).toContain('Order not found');
    }
  });

  it('returns not dispatched when fulfillment type is pickup', async () => {
    const mockService = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                tenant_id: 'tenant-1',
                fulfillment_type: 'pickup',
              },
            }),
          })),
        })),
      })),
    };

    (createServiceClient as any).mockReturnValue(mockService);

    const result = await autoDispatch('order-1');
    expect(result.dispatched).toBe(false);
    if (!result.dispatched) {
      expect(result.reason).toContain('Only delivery orders');
    }
  });
});
