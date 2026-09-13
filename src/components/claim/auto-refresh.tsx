'use client';

import { useEffect } from 'react';

/**
 * Reloads the page after a delay. Used on the post-checkout page while
 * we're waiting on the GHL payment-confirmed webhook to land - it usually
 * arrives within a couple of seconds, but is never guaranteed to beat the
 * browser back from the payment link.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), seconds * 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return null;
}
