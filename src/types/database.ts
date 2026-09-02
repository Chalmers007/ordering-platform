/**
 * @/types/database — the single vocabulary the whole platform speaks.
 *
 * `./supabase.ts` is GENERATED from the live schema:
 *
 *     npm run db:types
 *
 * Never hand-edit it, and never import it directly outside this file. Import
 * from here instead, so that a schema change surfaces as a type error in
 * application code rather than as a runtime surprise.
 *
 * Everything below is either a re-export of generated truth or a domain type
 * that has no table of its own (carts, ESC/POS jobs, dispatch payloads).
 */

import type { Database, Json } from './supabase';

export type { Database, Json };

type Public = Database['public'];
type T = Public['Tables'];
type F = Public['Functions'];

/** Row / Insert / Update helpers, so call sites read as `TableRow<'orders'>`
 *  when they are generic and as `Order` when they are not. */
export type TableName = keyof T;
export type TableRow<N extends TableName> = T[N]['Row'];
export type TableInsert<N extends TableName> = T[N]['Insert'];
export type TableUpdate<N extends TableName> = T[N]['Update'];

// =====================================================================
// Enumerations
// =====================================================================
export type TenantStatus = Public['Enums']['tenant_status'];
export type SubscriptionStatus = Public['Enums']['subscription_status'];
export type UserRole = Public['Enums']['user_role'];
export type PaymentProvider = Public['Enums']['payment_provider'];
export type GatewayAccountStatus = Public['Enums']['gateway_account_status'];
export type ModifierSelectionType = Public['Enums']['modifier_selection_type'];
export type FulfillmentType = Public['Enums']['fulfillment_type'];
export type OrderStatus = Public['Enums']['order_status'];
export type PaymentStatus = Public['Enums']['payment_status'];
export type DeliveryStatus = Public['Enums']['delivery_status'];
export type WebhookEventType = Public['Enums']['webhook_event_type'];
export type WebhookDeliveryStatus = Public['Enums']['webhook_delivery_status'];
export type AuditAction = Public['Enums']['audit_action'];

/** Runtime-checkable values, derived from the same generated constants the
 *  types come from — so a new enum member cannot be added to the database
 *  and forgotten in a `<Select>` or a Zod schema. */
export {
  Constants as DatabaseConstants,
} from './supabase';

// =====================================================================
// Row aliases
// =====================================================================
export type Tenant = TableRow<'tenants'>;
export type TenantInsert = TableInsert<'tenants'>;
export type TenantUpdate = TableUpdate<'tenants'>;

export type TenantDomain = TableRow<'tenant_domains'>;
export type TenantDomainInsert = TableInsert<'tenant_domains'>;

export type TenantSettings = TableRow<'tenant_settings'>;
export type TenantSettingsUpdate = TableUpdate<'tenant_settings'>;

export type UserProfile = TableRow<'user_profiles'>;
export type UserProfileUpdate = TableUpdate<'user_profiles'>;

export type PaymentGatewayAccount = TableRow<'payment_gateway_accounts'>;
export type ImpersonationSession = TableRow<'impersonation_sessions'>;

export type MenuCategory = TableRow<'menu_categories'>;
export type MenuCategoryInsert = TableInsert<'menu_categories'>;
export type MenuCategoryUpdate = TableUpdate<'menu_categories'>;

export type MenuItem = TableRow<'menu_items'>;
export type MenuItemInsert = TableInsert<'menu_items'>;
export type MenuItemUpdate = TableUpdate<'menu_items'>;

export type MenuModifierGroup = TableRow<'menu_modifier_groups'>;
export type MenuModifier = TableRow<'menu_modifiers'>;
export type MenuItemModifierGroup = TableRow<'menu_item_modifier_groups'>;

export type Order = TableRow<'orders'>;
export type OrderInsert = TableInsert<'orders'>;
export type OrderUpdate = TableUpdate<'orders'>;

export type OrderItem = TableRow<'order_items'>;
export type OrderItemInsert = TableInsert<'order_items'>;
export type OrderItemModifier = TableRow<'order_item_modifiers'>;
export type OrderStatusEvent = TableRow<'order_status_events'>;

export type Delivery = TableRow<'deliveries'>;
export type WebhookEvent = TableRow<'webhook_events'>;
export type AuditLog = TableRow<'audit_logs'>;

// =====================================================================
// RPC return shapes (generated, so they cannot drift from the SQL)
// =====================================================================
export type StorefrontResolution = F['resolve_storefront']['Returns'][number];
export type TrackedOrder = F['get_order_by_tracking_token']['Returns'][number];

// =====================================================================
// Composite read models
// The shapes the UI actually renders. Each one corresponds to a real
// PostgREST embed, e.g.
//   .select('*, menu_categories(*), menu_item_modifier_groups(*, ...)')
// =====================================================================

export type MenuItemWithModifiers = MenuItem & {
  menu_item_modifier_groups: Array<
    MenuItemModifierGroup & {
      menu_modifier_groups: MenuModifierGroup & { menu_modifiers: MenuModifier[] };
    }
  >;
};

export type MenuCategoryWithItems = MenuCategory & {
  menu_items: MenuItemWithModifiers[];
};

export type OrderItemWithModifiers = OrderItem & {
  order_item_modifiers: OrderItemModifier[];
};

/** What the KDS card and the staff order drawer both render. */
export type OrderWithDetails = Order & {
  order_items: OrderItemWithModifiers[];
  deliveries: Delivery | null;
  order_status_events: OrderStatusEvent[];
};

/** Everything the storefront needs before it can render a menu, in one read. */
export type Storefront = {
  tenant: Pick<Tenant, 'id' | 'slug' | 'name' | 'status' | 'timezone' | 'currency'>;
  settings: TenantSettings;
  categories: MenuCategoryWithItems[];
};

// =====================================================================
// Tenant context
// Set by middleware.ts from the resolved host and read via `headers()`.
// No component ever derives a tenant from the client.
// =====================================================================
export type Surface = 'admin' | 'app' | 'storefront' | 'marketing';

export type TenantContext = {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  hostname: string;
  /** True when a super admin is viewing this tenant through impersonation. */
  impersonated: boolean;
};

// =====================================================================
// Cart & pricing
// The client computes a preview for display; the server recomputes every
// figure from the database before charging anything. These types are the
// contract between the two, not a substitute for the server calculation.
// =====================================================================

export type CartModifierSelection = {
  modifierId: string;
  groupId: string;
  quantity: number;
};

export type CartLine = {
  /** Client-side line identity: the same item with different modifiers is
   *  two lines, so the item id alone is not enough. */
  lineId: string;
  menuItemId: string;
  quantity: number;
  notes?: string;
  modifiers: CartModifierSelection[];
};

export type Cart = {
  tenantId: string;
  fulfillmentType: FulfillmentType;
  lines: CartLine[];
  tipCents: number;
  promoCode?: string;
};

/**
 * A fully priced cart. Every field is integer cents, and the identity
 *
 *   totalCents = subtotal - discount + tax + tip + delivery + service + tech
 *
 * is the same one the `orders_total_chk` constraint enforces in Postgres.
 */
export type PricedCart = {
  lines: Array<{
    lineId: string;
    menuItemId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    modifiersTotalCents: number;
    lineTotalCents: number;
    /** Kitchen note for this line; snapshotted onto `order_items.notes`. */
    notes: string | null;
    modifiers: Array<{
      modifierId: string;
      groupName: string;
      name: string;
      priceDeltaCents: number;
      quantity: number;
    }>;
  }>;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  /** 0 unless `tenant_settings.tech_fee_enabled`. Routed to the platform
   *  account as Stripe's `application_fee_amount`. */
  techFeeCents: number;
  totalCents: number;
  currency: string;
  /** Echoed back by price_cart() so the checkout session records the
   *  fulfilment the prices were actually computed for. */
  fulfillmentType: FulfillmentType;
};

// =====================================================================
// Payments
// =====================================================================

/**
 * The split every gateway adapter must implement:
 * the tech fee goes to the platform, everything else to the restaurant.
 */
export type PaymentSplit = {
  /** Charged to the customer. */
  totalCents: number;
  /** Routed to the platform account (Stripe `application_fee_amount`). */
  applicationFeeCents: number;
  /** The tenant's connected account: `acct_…`, a Square merchant id, or a
   *  PayPal merchant id, depending on `provider`. */
  destinationAccountId: string;
  provider: PaymentProvider;
  currency: string;
};

export type PaymentIntentResult = {
  provider: PaymentProvider;
  intentId: string;
  /** Stripe client secret / Square payment link / PayPal order id. */
  clientToken: string;
  status: PaymentStatus;
};

// =====================================================================
// Dispatch
//
// The courier provider is an implementation detail. Nothing in these types
// names it, and `providerRef` never crosses the wire to a browser — the
// storefront tracks orders through /api/dispatch/track, which reads from
// `deliveries`.
// =====================================================================

export type DispatchStop = {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
  instructions?: string;
};

export type DispatchRequest = {
  orderId: string;
  tenantId: string;
  orderNumber: string;
  pickup: DispatchStop;
  dropoff: DispatchStop;
  items: Array<{ name: string; quantity: number; unitPriceCents: number }>;
  totalCents: number;
  tipCents: number;
  readyAt: string | null;
};

export type DispatchResult = {
  /** Internal only. Persisted to `deliveries.external_ref`, never serialised
   *  into a client response. */
  providerRef: string;
  status: DeliveryStatus;
  estimatedPickupAt: string | null;
  estimatedDeliveryAt: string | null;
};

/** Exactly what /api/dispatch/track returns to the storefront map. */
export type DispatchTrackingSnapshot = {
  status: DeliveryStatus;
  courierName: string | null;
  courierPhone: string | null;
  courierPhotoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  locationUpdatedAt: string | null;
  estimatedDeliveryAt: string | null;
};

// =====================================================================
// Kitchen Display System
// =====================================================================

export type KdsColumn = Extract<
  OrderStatus,
  'paid' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery'
>;

export type KdsBoard = Record<KdsColumn, OrderWithDetails[]>;

export type KitchenControls = Pick<
  TenantSettings,
  'is_kitchen_paused' | 'kitchen_paused_at' | 'kitchen_paused_reason' | 'estimated_prep_time_mins'
>;

// =====================================================================
// Thermal printing (ESC/POS)
// =====================================================================

/**
 * A browser cannot open a raw TCP socket, so `network` means "the server
 * opens it" (self-hosted, sharing a LAN with the printer) and `websocket`
 * means "a bridge agent on the kitchen LAN holds it" — the path that works
 * from a cloud deployment.
 */
export type PrinterTransport = 'bluetooth' | 'network' | 'websocket' | 'browser-print';

export type PrinterConfig = {
  transport: PrinterTransport;
  /** Network transport only. */
  host?: string;
  port?: number;
  /** Web Bluetooth only: the GATT characteristic to write to. */
  serviceUuid?: string;
  characteristicUuid?: string;
  /** 58mm ≈ 32 chars, 80mm ≈ 48 chars. */
  columns: 32 | 48;
  copies: number;
  autoPrintOnCreate: boolean;
};

/** A rendered ticket ready to be pushed to a printer. `bytes` is the encoded
 *  ESC/POS command stream; `preview` is the same ticket as text, which is what
 *  makes this testable without hardware. */
export type PrintJob = {
  orderId: string;
  orderNumber: string;
  bytes: Uint8Array;
  preview: string;
  createdAt: string;
};

// =====================================================================
// Outbound webhooks (GoHighLevel)
// =====================================================================

export type GhlContactPayload = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  tags: string[];
};

export type GhlOrderPayload = {
  event: WebhookEventType;
  tenantId: string;
  tenantName: string;
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  isFirstTimeCustomer: boolean;
  totalCents: number;
  currency: string;
  placedAt: string | null;
  contact: GhlContactPayload;
  items: Array<{ name: string; quantity: number; lineTotalCents: number }>;
};

// =====================================================================
// Server Action results
//
// Server Actions return this instead of throwing, so every form can render
// an error inline and the type system forces the caller to handle failure.
// =====================================================================

export type ActionSuccess<TData> = { ok: true; data: TData };

export type ActionFailure = {
  ok: false;
  error: string;
  /** Field-level messages for form rendering, keyed by field name. */
  fieldErrors?: Record<string, string[]>;
  code?: 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'gateway' | 'unknown';
};

export type ActionResult<TData = void> = ActionSuccess<TData> | ActionFailure;

export const ok = <TData>(data: TData): ActionSuccess<TData> => ({ ok: true, data });

export const fail = (
  error: string,
  options: Omit<ActionFailure, 'ok' | 'error'> = {},
): ActionFailure => ({ ok: false, error, ...options });

// =====================================================================
// Role predicates
// Convenience only. Authorisation is enforced by RLS in Postgres; these
// exist so the UI can hide what a user cannot do, not to decide it.
// =====================================================================

export const isSuperAdmin = (p: Pick<UserProfile, 'role'> | null): boolean =>
  p?.role === 'super_admin';

export const isTenantOwner = (p: Pick<UserProfile, 'role'> | null): boolean =>
  p?.role === 'tenant_owner';

export const isTenantMember = (p: Pick<UserProfile, 'role'> | null): boolean =>
  p?.role === 'tenant_owner' || p?.role === 'tenant_staff';

/** Statuses the kitchen still owns — the KDS board query. */
export const OPEN_ORDER_STATUSES = [
  'paid',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
] as const satisfies readonly OrderStatus[];

export const TERMINAL_ORDER_STATUSES = [
  'completed',
  'cancelled',
  'refunded',
] as const satisfies readonly OrderStatus[];
