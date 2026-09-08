/**
 * Factory for billing provider instances.
 */

import { getActiveBillingProvider } from './provider';
import { StripeProvider } from './stripe-provider';
import { GHLProvider } from './ghl-provider';
import type { BillingProviderImpl } from './provider';

export function getBillingProvider(): BillingProviderImpl {
  const provider = getActiveBillingProvider();

  if (provider === 'ghl') {
    return new GHLProvider();
  }

  // Default to Stripe
  return new StripeProvider();
}
