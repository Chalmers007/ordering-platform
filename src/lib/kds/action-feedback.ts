import type { OrderStatus } from '@/types/database';

const LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Order accepted',
  preparing: 'Order is now preparing',
  ready: 'Order marked ready',
  out_for_delivery: 'Order handed to driver',
  completed: 'Order completed',
};

export function transitionFeedback(status: OrderStatus): string {
  return LABELS[status] ?? 'Order updated';
}

export function declineFeedback(status: OrderStatus): string {
  return status === 'paid' || status === 'confirmed' ? 'Order declined' : 'Order cancelled';
}
