'use client';

import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Form to store demo Uber sandbox Customer ID.
 * Uses the set-demo-uber-id endpoint.
 */
export function StoreUberIdForm() {
  const [customerId, setCustomerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId.trim()) {
      toast.error('Customer ID is required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/set-demo-uber-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customerId.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setResult({ ok: true, message: 'Stored successfully' });
        setCustomerId('');
        toast.success('Uber Customer ID stored');
      } else {
        setResult({ ok: false, message: data.error || 'Store failed' });
        toast.error(data.error || 'Failed to store');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      setResult({ ok: false, message });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div>
        <label htmlFor="uber-id" className="block text-sm font-medium text-amber-900">
          Uber Sandbox Customer ID
        </label>
        <input
          id="uber-id"
          type="text"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          placeholder="004c2eff-6414-5048-bc78-e1558a1ea939"
          disabled={loading}
          className="mt-1 w-full rounded border border-amber-300 px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !customerId.trim()}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {loading ? 'Storing...' : 'Store ID'}
        </button>
      </div>

      {result && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            result.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {result.ok ? '✓ ' : '✗ '}
          {result.message}
        </div>
      )}
    </form>
  );
}
