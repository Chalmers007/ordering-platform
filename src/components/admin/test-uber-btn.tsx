'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function TestUberBtn() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    environment?: string;
  } | null>(null);

  async function handleTest() {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/test-uber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();
      setResult(data);

      if (response.ok && data.success) {
        toast.success('Uber connection OK');
      } else {
        toast.error(data.error ?? 'Connection failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test failed');
      setResult({ success: false, error: 'Test error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleTest} disabled={loading} variant="outline" size="sm">
        {loading ? 'Testing...' : 'Test Uber'}
      </Button>
      {result && (
        <div
          className={`rounded p-2 text-xs ${
            result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {result.success ? '✓ ' : '✗ '}
          {result.message || result.error}
          {result.environment && <span className="text-gray-600 ml-2">({result.environment})</span>}
        </div>
      )}
    </div>
  );
}
