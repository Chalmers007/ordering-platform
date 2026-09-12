export type DeliveryCostMode = 'restaurant' | 'customer' | 'split';

export function allocateDeliveryFee(
  totalCents: number,
  mode: DeliveryCostMode,
  customerSharePercent?: number,
): { customerCents: number; restaurantCents: number } {
  const customerCents =
    mode === 'restaurant'
      ? 0
      : mode === 'split'
        ? Math.round((totalCents * (customerSharePercent ?? 0)) / 100)
        : totalCents;
  return { customerCents, restaurantCents: totalCents - customerCents };
}
