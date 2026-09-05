'use client';

import { useEffect, useState } from 'react';
import { MapPin, Phone, Clock, Truck } from 'lucide-react';

interface DeliveryStatus {
  status: 'assigned' | 'picked_up' | 'en_route' | 'delivered' | 'failed';
  courierName?: string;
  courierPhone?: string;
  courierLatitude?: number;
  courierLongitude?: number;
  estimatedDeliveryAt?: string;
  trackingUrl?: string;
  lastUpdate: string;
}

/**
 * Real-time delivery tracking component.
 *
 * Shows customer current delivery status, driver name/phone, ETA, and tracking link.
 * Polls for updates every 10 seconds while in transit.
 */
export function DeliveryTracker({ orderId, trackingToken }: { orderId: string; trackingToken: string }) {
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/tracking?token=${trackingToken}`);
        if (!res.ok) throw new Error('Failed to fetch status');
        const data = await res.json();
        setStatus(data);
        setError(null);

        // Stop polling if delivered or failed
        if (data.status === 'delivered' || data.status === 'failed') {
          clearInterval(interval);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, 10000); // Poll every 10s

    return () => clearInterval(interval);
  }, [orderId, trackingToken]);

  if (loading) return <div className="animate-pulse">Loading delivery status...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!status) return <div>No delivery found</div>;

  const statusMessages = {
    assigned: 'Driver assigned',
    picked_up: 'Order picked up',
    en_route: 'On the way',
    delivered: 'Delivered',
    failed: 'Delivery failed',
  };

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        <Truck className={`h-5 w-5 ${status.status === 'delivered' ? 'text-green-600' : 'text-blue-600'}`} />
        <h3 className="font-semibold">{statusMessages[status.status]}</h3>
      </div>

      {status.courierName && (
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-gray-600">Driver</p>
            <p className="font-medium">{status.courierName}</p>
          </div>

          {status.courierPhone && (
            <div>
              <a href={`tel:${status.courierPhone}`} className="flex items-center gap-2 text-blue-600 hover:underline">
                <Phone className="h-4 w-4" />
                {status.courierPhone}
              </a>
            </div>
          )}
        </div>
      )}

      {status.estimatedDeliveryAt && status.status !== 'delivered' && (
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-gray-500" />
          <span>
            Arriving {new Date(status.estimatedDeliveryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {status.trackingUrl && (
        <a href={status.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
          <MapPin className="h-4 w-4" />
          View on map
        </a>
      )}

      <p className="text-xs text-gray-500">Last updated: {new Date(status.lastUpdate).toLocaleTimeString()}</p>
    </div>
  );
}
