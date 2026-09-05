import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { createDeliveryQuote } from '@/lib/uber';

/**
 * Calculate delivery fees for checkout.
 *
 * Gets a quote from Uber for the order's delivery address
 * and returns the fee to show the customer.
 */

export interface DeliveryQuoteInfo {
  feeUsd: number;
  feeCents: number;
  currency: string;
  estimatedDeliveryMinutes: number;
  dropoffEta: string;
}

/**
 * Get delivery fee quote for an order.
 *
 * Called during checkout before order is placed.
 * Returns quote ID for idempotent dispatch later.
 */
export async function getDeliveryQuote(
  tenantId: string,
  dropoffAddress: string,
  dropoffLatitude?: number,
  dropoffLongitude?: number,
  deliveryValue: number = 2500, // cents
): Promise<DeliveryQuoteInfo | null> {
  const service = createServiceClient();

  // Get restaurant address
  const { data: settings } = await service
    .from('tenant_settings')
    .select('address_line1, address_line2, city, region, postal_code, latitude, longitude')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!settings?.address_line1 || !settings.city || !settings.postal_code) {
    return null;
  }

  // Get Uber customer ID
  const { data: secret } = await service
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'uber_customer_id')
    .maybeSingle();

  if (!secret?.value) {
    return null;
  }

  const pickupAddress = [
    settings.address_line1,
    settings.address_line2,
    settings.city,
    settings.region,
    settings.postal_code,
  ]
    .filter(Boolean)
    .join(', ');

  try {
    const quote = await createDeliveryQuote(secret.value, {
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      pickup_latitude: settings.latitude ?? undefined,
      pickup_longitude: settings.longitude ?? undefined,
      dropoff_latitude: dropoffLatitude,
      dropoff_longitude: dropoffLongitude,
      manifest_total_value: deliveryValue,
    });

    const feeUsd = quote.fee / 100;

    return {
      feeUsd,
      feeCents: quote.fee,
      currency: quote.currency,
      estimatedDeliveryMinutes: Math.ceil(quote.duration / 60),
      dropoffEta: quote.dropoff_eta || new Date().toISOString(),
    };
  } catch (error) {
    console.error('[delivery-fees] Quote failed', tenantId, error);
    return null;
  }
}
