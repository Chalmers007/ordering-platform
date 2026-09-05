'use client';

import { useState } from 'react';
import { Search, RefreshCw, XCircle, CheckCircle } from 'lucide-react';

interface DeliveryOrder {
  orderId: string;
  customerId: string;
  deliveryId: string;
  status: 'assigned' | 'picked_up' | 'en_route' | 'delivered' | 'failed' | 'unassigned' | 'cancelled';
  attempts: number;
  lastError?: string;
  courierName?: string;
  createdAt: string;
  updatedAt: string;
}

export function SearchDeliveries() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/dispatch/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults(data.orders);
    } catch (err) {
      setMessage({ type: 'error', text: 'Search failed' });
    } finally {
      setLoading(false);
    }
  };

  const retry = async (orderId: string) => {
    setRetrying(orderId);
    try {
      const res = await fetch('/api/admin/dispatch/retry-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error('Retry failed');
      setMessage({ type: 'success', text: 'Retry scheduled' });
      await new Promise((r) => setTimeout(r, 1000));
      search({ preventDefault: () => {} } as any);
    } catch (err) {
      setMessage({ type: 'error', text: 'Retry failed' });
    } finally {
      setRetrying(null);
    }
  };

  const cancel = async (orderId: string) => {
    if (!confirm('Cancel this delivery?')) return;
    setCancelling(orderId);
    try {
      const res = await fetch('/api/admin/dispatch/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error('Cancel failed');
      setMessage({ type: 'success', text: 'Delivery cancelled' });
      await new Promise((r) => setTimeout(r, 1000));
      search({ preventDefault: () => {} } as any);
    } catch (err) {
      setMessage({ type: 'error', text: 'Cancel failed' });
    } finally {
      setCancelling(null);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      delivered: 'bg-green-100 text-green-900',
      en_route: 'bg-blue-100 text-blue-900',
      picked_up: 'bg-blue-100 text-blue-900',
      assigned: 'bg-yellow-100 text-yellow-900',
      unassigned: 'bg-gray-100 text-gray-900',
      failed: 'bg-red-100 text-red-900',
      cancelled: 'bg-gray-100 text-gray-900',
    };
    return colors[status] || 'bg-gray-100 text-gray-900';
  };

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID, customer phone, or email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-semibold"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'
          }`}
        >
          {message.text}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-600">{results.length} results</p>
          {results.map((order) => (
            <div key={order.orderId} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{order.orderId}</p>
                  <p className="text-sm text-gray-600">Delivery: {order.deliveryId}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`inline-block px-3 py-1 rounded text-sm font-semibold ${getStatusColor(order.status)}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                    {order.courierName && (
                      <span className="inline-block px-3 py-1 rounded text-sm bg-gray-100 text-gray-900">
                        Driver: {order.courierName}
                      </span>
                    )}
                    <span className="inline-block px-3 py-1 rounded text-sm bg-gray-100 text-gray-900">
                      Attempts: {order.attempts}
                    </span>
                  </div>

                  {order.lastError && (
                    <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1 inline-block">
                      {order.lastError}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-gray-500">
                    Updated: {new Date(order.updatedAt).toLocaleString()}
                  </p>
                </div>

                {order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <div className="flex gap-2 flex-shrink-0">
                    {order.status === 'unassigned' && order.attempts < 5 && (
                      <button
                        onClick={() => retry(order.orderId)}
                        disabled={retrying === order.orderId}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-900 rounded-lg hover:bg-blue-200 disabled:bg-gray-200 font-semibold text-sm"
                      >
                        <RefreshCw className="h-4 w-4" />
                        {retrying === order.orderId ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                    <button
                      onClick={() => cancel(order.orderId)}
                      disabled={cancelling === order.orderId}
                      className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-900 rounded-lg hover:bg-red-200 disabled:bg-gray-200 font-semibold text-sm"
                    >
                      <XCircle className="h-4 w-4" />
                      {cancelling === order.orderId ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && query && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No orders found</p>
        </div>
      )}
    </div>
  );
}
