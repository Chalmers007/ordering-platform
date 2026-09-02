import {
  CMD,
  COLUMNS_80MM,
  EscPosBuilder,
  type Columns,
} from './escpos';
import type { OrderWithDetails, PrintJob } from '@/types/database';

/**
 * Order -> kitchen ticket.
 *
 * Takes the real `OrderWithDetails` shape the KDS already holds, so a ticket
 * cannot drift from what is on screen. Money is formatted from integer cents
 * here and nowhere else in the print path.
 */

export type TicketOptions = {
  restaurantName: string;
  columns?: Columns;
  currency?: string;
  /** Kitchen copy omits prices; the customer copy shows them. */
  variant?: 'kitchen' | 'customer';
  timeZone?: string;
  kickDrawer?: boolean;
  partialCut?: boolean;
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function time(value: string | null, timeZone?: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function renderTicket(order: OrderWithDetails, options: TicketOptions): PrintJob {
  const {
    restaurantName,
    columns = COLUMNS_80MM,
    currency = order.currency,
    variant = 'kitchen',
    timeZone,
    kickDrawer = false,
    partialCut = false,
  } = options;

  const showPrices = variant === 'customer';
  const b = new EscPosBuilder(columns);

  b.centered(restaurantName);
  b.centered(variant === 'kitchen' ? 'KITCHEN COPY' : 'RECEIPT');
  b.feed();

  // The number a cook shouts across the pass — big, before anything else.
  b.heading(`#${order.order_number}`);

  b.centered(
    order.fulfillment_type === 'delivery' ? '** DELIVERY **' : '** PICKUP **',
  );
  b.feed();
  b.rule();

  b.columnsRow('Placed', time(order.placed_at ?? order.created_at, timeZone));
  if (order.promised_at) {
    b.columnsRow('Promised', time(order.promised_at, timeZone));
  }
  b.columnsRow('Customer', order.customer_name);
  b.columnsRow('Phone', order.customer_phone);

  if (order.fulfillment_type === 'delivery' && order.delivery_address_line1) {
    b.feed();
    b.bold('DELIVER TO');
    b.line(order.delivery_address_line1);
    if (order.delivery_address_line2) b.line(order.delivery_address_line2);
    b.line(
      [order.delivery_city, order.delivery_region, order.delivery_postal_code]
        .filter(Boolean)
        .join(', '),
    );
    if (order.delivery_instructions) {
      b.feed();
      b.line(`Note: ${order.delivery_instructions}`);
    }
  }

  b.rule();
  b.feed();

  for (const item of order.order_items) {
    const label = `${item.quantity}x ${item.name_snapshot}`;
    if (showPrices) b.columnsRow(label, money(item.line_total_cents, currency), ' ');
    else b.bold(label);

    for (const modifier of item.order_item_modifiers) {
      const sign =
        modifier.price_delta_cents > 0
          ? ` (+${money(modifier.price_delta_cents, currency)})`
          : '';
      b.line(`   + ${modifier.name_snapshot}${showPrices ? sign : ''}`);
    }

    // Special instructions must survive to the line cook, always.
    if (item.notes) b.line(`   ** ${item.notes.toUpperCase()}`);
    b.feed();
  }

  if (order.notes) {
    b.rule();
    b.bold('ORDER NOTES');
    b.line(order.notes);
    b.feed();
  }

  if (showPrices) {
    b.rule();
    b.columnsRow('Subtotal', money(order.subtotal_cents, currency), ' ');
    if (order.discount_cents > 0) {
      b.columnsRow('Discount', `-${money(order.discount_cents, currency)}`, ' ');
    }
    if (order.delivery_fee_cents > 0) {
      b.columnsRow('Delivery', money(order.delivery_fee_cents, currency), ' ');
    }
    if (order.service_fee_cents > 0) {
      b.columnsRow('Service fee', money(order.service_fee_cents, currency), ' ');
    }
    if (order.tech_fee_cents > 0) {
      b.columnsRow('Technology fee', money(order.tech_fee_cents, currency), ' ');
    }
    if (order.tax_cents > 0) b.columnsRow('Tax', money(order.tax_cents, currency), ' ');
    if (order.tip_cents > 0) b.columnsRow('Tip', money(order.tip_cents, currency), ' ');
    b.raw(CMD.BOLD_ON);
    b.columnsRow('TOTAL', money(order.total_cents, currency), ' ');
    b.raw(CMD.BOLD_OFF);
    b.feed();
    b.centered(order.payment_status === 'paid' ? 'PAID' : order.payment_status.toUpperCase());
  }

  if (kickDrawer) b.kickDrawer();
  b.cut(partialCut);

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    bytes: b.build(),
    preview: b.preview(),
    createdAt: new Date().toISOString(),
  };
}
