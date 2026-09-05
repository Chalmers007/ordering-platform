'use client';

import { AlertCircle, Home, Calendar } from 'lucide-react';

interface DeliveryErrorRecoveryProps {
  orderId: string;
  reason?: string;
  onPickup?: () => void;
  onReschedule?: () => void;
}

export function DeliveryErrorRecovery({
  orderId,
  reason,
  onPickup,
  onReschedule,
}: DeliveryErrorRecoveryProps) {
  const reasons: Record<string, { title: string; message: string }> = {
    'Restaurant closed': {
      title: 'Restaurant is closed',
      message: 'The restaurant is temporarily closed. Your order will be held.',
    },
    'Driver unable to reach': {
      title: "Driver couldn't reach the address",
      message: 'Please ensure your delivery address is correct and accessible.',
    },
    'Delivery address invalid': {
      title: 'Invalid delivery address',
      message: 'The address provided could not be found. Please update it.',
    },
    'Restaurant refused order': {
      title: 'Restaurant unable to fulfill',
      message: 'The restaurant is unable to complete your order at this time.',
    },
  };

  const errorInfo = reason && reasons[reason] ? reasons[reason] : {
    title: 'Delivery could not be completed',
    message: 'We were unable to complete your delivery. Please choose an alternative.',
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-6">
      {/* Error Header */}
      <div className="flex gap-3 mb-4">
        <AlertCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
        <div>
          <p className="font-semibold text-red-900">{errorInfo.title}</p>
          <p className="text-sm text-red-800 mt-1">{errorInfo.message}</p>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {onPickup && (
          <button
            onClick={onPickup}
            className="w-full flex items-center gap-3 rounded-lg border border-red-300 bg-white px-4 py-3 text-left font-semibold text-red-900 hover:bg-red-50 active:bg-red-100"
          >
            <Home className="h-5 w-5" />
            <div>
              <p>Pick up at restaurant</p>
              <p className="text-xs font-normal text-gray-600">Come get your food</p>
            </div>
          </button>
        )}

        {onReschedule && (
          <button
            onClick={onReschedule}
            className="w-full flex items-center gap-3 rounded-lg border border-red-300 bg-white px-4 py-3 text-left font-semibold text-red-900 hover:bg-red-50 active:bg-red-100"
          >
            <Calendar className="h-5 w-5" />
            <div>
              <p>Reschedule delivery</p>
              <p className="text-xs font-normal text-gray-600">Try again later</p>
            </div>
          </button>
        )}

        <a
          href="mailto:support@ordering-platform.com"
          className="block w-full rounded-lg border border-red-300 bg-white px-4 py-3 text-center font-semibold text-red-900 hover:bg-red-50 active:bg-red-100"
        >
          Contact support
        </a>
      </div>

      {/* Refund Info */}
      <div className="mt-4 rounded-lg bg-white p-3 text-xs text-gray-600">
        <p className="font-semibold text-gray-900 mb-1">Refund Policy</p>
        <p>You will receive a full refund within 3-5 business days if delivery cannot be completed.</p>
      </div>

      {/* Order Details */}
      <p className="mt-4 text-xs text-gray-600 text-center">Order #{orderId}</p>
    </div>
  );
}
