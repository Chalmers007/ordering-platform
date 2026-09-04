'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { testUberConnection } from '@/lib/admin/test-uber-connection';
import { toast } from 'sonner';

export function TestUberButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof testUberConnection>> | null>(null);

  async function handleTest() {
    setLoading(true);
    try {
      const res = await testUberConnection();
      setResult(res);
      if (res.ok) {
        toast.success('Uber connection test passed');
      } else {
        toast.error(res.error || 'Connection test failed');
      }
    } catch (error) {
      toast.error('Test error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleTest} disabled={loading} variant="outline">
        {loading ? 'Testing...' : 'Test Uber Connection'}
      </Button>

      {result && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            result.ok
              ? 'border-green-200 bg-green-50'
              : 'border-red-200 bg-red-50'
          }`}
        >
          <p className="font-semibold">
            {result.ok ? '✓ Sandbox Available' : '✗ Connection Failed'}
          </p>
          <p className="mt-1 text-xs text-gray-600">Environment: {result.environment}</p>

          {result.oauth && (
            <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
              <p className="text-xs font-medium">OAuth:</p>
              <p className={`text-xs ${result.oauth.ok ? 'text-green-700' : 'text-red-700'}`}>
                {result.oauth.ok ? '✓ Authenticated' : `✗ ${result.oauth.error}`}
              </p>
              {result.oauth.grantedScope && (
                <p className="text-xs text-gray-600">Scope: {result.oauth.grantedScope}</p>
              )}
            </div>
          )}

          {result.quote && (
            <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
              <p className="text-xs font-medium">Quote Test:</p>
              <p className={`text-xs ${result.quote.ok ? 'text-green-700' : 'text-red-700'}`}>
                {result.quote.ok ? '✓ Quote available' : `✗ ${result.quote.error}`}
              </p>
              {result.quote.feeCents && (
                <p className="text-xs text-gray-600">Fee: ${(result.quote.feeCents / 100).toFixed(2)}</p>
              )}
            </div>
          )}

          {result.error && (
            <p className="mt-2 text-xs text-red-700">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
