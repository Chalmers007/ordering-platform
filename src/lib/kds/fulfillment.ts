export type FulfillmentAvailability = {
  accepts_pickup: boolean;
  accepts_delivery: boolean;
};

export function fulfillmentStatus(settings: FulfillmentAvailability): string {
  const modes = [
    settings.accepts_pickup ? 'Pickup' : null,
    settings.accepts_delivery ? 'Delivery' : null,
  ].filter(Boolean);
  return modes.length > 0 ? `Accepting ${modes.join(' + ')}` : 'No fulfilment available';
}
