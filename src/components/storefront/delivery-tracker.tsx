'use client';

import { useEffect, useState } from 'react';
import { MapPin, Phone, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface DeliveryStatus {
  status: 'assigned' | 'picked_up' | 'en_route' | 'delivered' | 'failed';
  courierName?: string;
  courierPhone?: string;
  estimatedDeliveryAt?: string;
  trackingUrl?: string;
  lastUpdate: string;
}

export function DeliveryTracker({ orderId, trackingToken }: { orderId: string; trackingToken: string }) {
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    let pollInterval: NodeJS.Timeout;
    let timerInterval: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/tracking?token=${trackingToken}`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
          if (data.status === 'delivered' || data.status === 'failed') {
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        // Silent fail - show cached status
      } finally {
        setLoading(false);
      }
    };

    const updateTimer = () => {
      if (!status?.estimatedDeliveryAt) return;
      const now = new Date().getTime();
      const eta = new Date(status.estimatedDeliveryAt).getTime();
      const diff = eta - now;

      if (diff <= 0) {
        setTimeLeft('Arriving now');
      } else {
        const minutes = Math.floor(diff / 60000);
        setTimeLeft(minutes > 0 ? `${minutes} min` : 'Arriving now');
      }
    };

    fetchStatus();
    pollInterval = setInterval(fetchStatus, 10000);
    timerInterval = setInterval(updateTimer, 15000);
    updateTimer();

    return () => {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
    };
  }, [orderId, trackingToken, status?.estimatedDeliveryAt]);

  if (loading || !status) {
    return (
      <div className="animate-pulse space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-6">
        <div className="h-4 w-32 rounded bg-gray-300" />
        <div className="h-12 rounded bg-gray-300" />
      </div>
    );
  }

  const stages = ['assigned', 'picked_up', 'en_route', 'delivered'] as const;
  const currentStageIndex = stages.indexOf(status.status as any);
  const isDelivered = status.status === 'delivered';
  const isFailed = status.status === 'failed';

  return (
    <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
      {/* Status Header */}
      <div className="mb-6">
        {isFailed ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Delivery couldn't complete</p>
              <p className="font-semibold text-gray-900">Please contact support</p>
            </div>
          </div>
        ) : isDelivered ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-green-900">Delivered!</p>
              <p className="text-sm text-gray-600">Your order has arrived</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <Clock className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-blue-900">
                {status.status === 'en_route' ? 'On the way' : status.status === 'picked_up' ? 'Order picked up' : 'Driver assigned'}
              </p>
              {timeLeft && <p className="text-sm text-gray-600">Arriving in {timeLeft}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {!isFailed && (
        <div className="mb-6">
          <div className="flex justify-between">
            {stages.map((stage, idx) => (
              <div key={stage} className="flex flex-col items-center flex-1">
                <div
                  className={`mb-2 h-3 w-3 rounded-full ${
                    idx <= currentStageIndex ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                />
                <p className="text-xs text-gray-600 text-center truncate">
                  {stage === 'assigned' ? 'Ready' : stage === 'picked_up' ? 'Picked up' : stage === 'en_route' ? 'Delivery' : 'Delivered'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Driver Info */}
      {status.courierName && status.status !== 'assigned' && (
        <div className="mb-6 rounded-lg bg-gray-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Your driver</p>
          <p className="mb-3 text-lg font-semibold text-gray-900">{status.courierName}</p>
          {status.courierPhone && (
            <a
              href={`tel:${status.courierPhone}`}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-semibold text-blue-600 shadow-sm hover:bg-blue-50 active:bg-blue-100"
            >
              <Phone className="h-4 w-4" />
              Call driver
            </a>
          )}
        </div>
      )}

      {/* Map Link */}
      {status.trackingUrl && !isDelivered && (
        <a
          href={status.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-100 active:bg-blue-200"
        >
          <MapPin className="h-4 w-4" />
          View live map
        </a>
      )}

      {/* Last Update */}
      <p className="text-xs text-gray-500">
        Last update: {new Date(status.lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}
