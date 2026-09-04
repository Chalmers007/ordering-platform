'use client';

import { useState } from 'react';
import { checkTenantUberCustomerId } from '@/lib/admin/actions';
import { toast } from 'sonner';

/**
 * Diagnostic component to check tenant configuration.
 * Calls server action with automatic request context (authenticated session).
 */
export function CheckTenantConfig({ tenantSlug }: { tenantSlug: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    tenantSlug?: string;
    hasUberCustomerId?: boolean;
    error?: string;
  } | null>(null);

  async function handleCheck() {
    setLoading(true);
    try {
      const res = await checkTenantUberCustomerId(tenantSlug);
      setResult(res);

      if (res.ok) {
        const status = res.hasUberCustomerId
          ? '✓ uber_customer_id is configured'
          : '✗ uber_customer_id is missing';
        toast.info(status);
      } else {
        toast.error(res.error ?? 'Check failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(message);
      setResult({ ok: false, error: message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleCheck}
        disabled={loading}
        className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {loading ? 'Checking...' : 'Check Config'}
      </button>
      {result && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            result.ok && result.hasUberCustomerId
              ? 'bg-green-50 text-green-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          {result.ok ? (
            <>
              {result.hasUberCustomerId
                ? '✓ uber_customer_id is configured'
                : '⚠ uber_customer_id is missing — quote check cannot run'}
            </>
          ) : (
            <>✗ {result.error}</>
          )}
        </div>
      )}
    </div>
  );
}
