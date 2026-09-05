'use client';

import { useEffect, useState } from 'react';
import { Truck, Info } from 'lucide-react';

interface DeliveryQuote {
  feeUsd: number;
  feeCents: number;
  currency: string;
  estimatedDeliveryMinutes: number;
  dropoffEta: string;
}

export function DeliveryFeeDisplay({
  tenantId,
  address,
  lat,
  lon,
}: {
  tenantId: string;
  address: string;
  lat?: number;
  lon?: number;
}) {
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    const fetchQuote = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          tenantId,
          dropoffAddress: address,
          ...(lat && { dropoffLatitude: lat.toString() }),
          ...(lon && { dropoffLongitude: lon.toString() }),
        });

        const res = await fetch(`/api/checkout/delivery-quote?${params}`);
        if (!res.ok) throw new Error('Could not calculate delivery fee');

        const data = await res.json();
        setQuote(data);
        setError(null);
      } catch (err) {
        setError(null); // Silent fail - delivery optional
        setQuote(null);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchQuote, 500); // Debounce address changes
    return () => clearTimeout(timer);
  }, [tenantId, address, lat, lon]);

  if (!loading && !quote) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex gap-3">
        <Truck className="h-5 w-5 flex-shrink-0 text-blue-600 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-gray-900">Delivery</p>
          {loading ? (
            <p className="text-sm text-gray-600 mt-1">Calculating fee...</p>
          ) : quote ? (
            <>
              <div className="flex items-baseline gap-1 mt-1">
                <p className="text-lg font-bold text-gray-900">${quote.feeUsd.toFixed(2)}</p>
                <p className="text-sm text-gray-600">
                  • {quote.estimatedDeliveryMinutes} min delivery
                </p>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Estimated arrival: {new Date(quote.dropoffEta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600 mt-1">Enter delivery address to see fee</p>
          )}
        </div>
      </div>
    </div>
  );
}
