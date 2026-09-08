'use client';

import { useState, useEffect } from 'react';

export function BookingLink({
  label,
  buttonText,
  urlEnvVar,
  showAfterPayment,
}: {
  label: string;
  buttonText: string;
  urlEnvVar: 'BOOKING_QUESTIONS_URL' | 'BOOKING_WALKTHROUGH_URL';
  showAfterPayment: boolean;
}) {
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(showAfterPayment);

  useEffect(() => {
    const url = process.env[`NEXT_PUBLIC_${urlEnvVar}`];
    let newHidden = showAfterPayment;

    if (showAfterPayment) {
      const params = new URLSearchParams(window.location.search);
      if (params.has('payment_confirmed')) {
        newHidden = false;
      }
    }

    // Batch state updates: React will combine these renders
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookingUrl(url ?? null);
    setHidden(newHidden);
  }, [showAfterPayment, urlEnvVar]);

  if (!bookingUrl || hidden) {
    return null;
  }

  return (
    <div className="text-center">
      <p className="mb-4 text-sm text-neutral-600">{label}</p>
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-lg border border-neutral-300 bg-white px-6 py-2 font-medium text-neutral-900 hover:bg-neutral-50 transition-colors"
      >
        {buttonText} →
      </a>
    </div>
  );
}
