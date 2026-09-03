# Order Creation & Auto-Dispatch Pipeline

This document describes the order creation workflow and automatic dispatch integration for the ordering platform.

## Overview

The order creation pipeline enables restaurants to accept orders directly and automatically dispatch them to courier services (Uber Direct or Shipday) without requiring a payment gateway.

### Key Features

- **Server-side pricing**: Cart prices are computed in the database, not trusted from the client
- **Atomic order creation**: Orders, line items, modifiers, and delivery records are created in a single transaction
- **Auto-dispatch**: Delivery orders are automatically sent to the configured courier provider
- **Idempotent dispatch**: Retrying a dispatch for the same order returns the existing reference
- **Graceful degradation**: Missing courier credentials allow manual dispatch later via the KDS

## Architecture

### Components

1. **`POST /api/orders/create`** - Main order creation endpoint
2. **`create_order_direct()` RPC** - Database function for atomic order creation
3. **`autoDispatch()` function** - Automatic dispatch to configured provider
4. **`auto-dispatch.ts` helper** - Provider-specific dispatch logic (Uber Direct, Shipday)

## API Usage

### Create an Order

**Endpoint**: `POST /api/orders/create`

**Request**:
```json
{
  "cart": {
    "fulfillmentType": "delivery",
    "tipCents": 500,
    "lines": [
      {
        "lineId": "line-1",
        "menuItemId": "550e8400-e29b-41d4-a716-446655440000",
        "quantity": 2,
        "notes": "No onions",
        "modifiers": [
          {
            "modifierId": "550e8400-e29b-41d4-a716-446655440001",
            "quantity": 1
          }
        ]
      }
    ]
  },
  "customer": {
    "name": "John Doe",
    "phone": "+1-555-0123",
    "email": "john@example.com"
  },
  "delivery": {
    "addressLine1": "123 Main St",
    "addressLine2": "Apt 4B",
    "city": "San Francisco",
    "region": "CA",
    "postalCode": "94102",
    "country": "US",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "instructions": "Ring doorbell twice"
  }
}
```

**Response** (Success, 200):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440002",
  "trackingToken": "550e8400-e29b-41d4-a716-446655440003",
  "trackingUrl": "/orders/550e8400-e29b-41d4-a716-446655440003",
  "pricedCart": {
    "lines": [...],
    "subtotalCents": 2500,
    "discountCents": 0,
    "taxCents": 220,
    "tipCents": 500,
    "deliveryFeeCents": 500,
    "serviceFeeCents": 250,
    "techFeeCents": 50,
    "totalCents": 4020,
    "currency": "USD",
    "fulfillmentType": "delivery"
  }
}
```

**Error Responses**:
- `404`: No storefront configured for this address
- `409`: Restaurant not accepting orders
- `422`: Invalid request (missing required fields, validation errors)
- `500`: Order creation or dispatch failed

## Request Validation

The route validates:

- **Storefront**: Must be active and configured for the request domain
- **Cart structure**: Required cart fields and line items
- **Customer info**: Name (1-120 chars), phone (7-32 chars)
- **Delivery address**: For delivery orders, all required fields must be present
  - `addressLine1`, `city`, `postalCode` are mandatory
  - `addressLine2`, `region`, `instructions` are optional
  - Coordinates (`latitude`, `longitude`) are optional but improve delivery routing

## Pricing Logic

Prices are computed server-side using the `price_cart()` RPC:

1. **Items**: Looked up from the menu database; sold-out or paused items are rejected
2. **Modifiers**: Validated against the item's modifier groups; missing groups are rejected
3. **Totals**: Tax, delivery fee, service fee, and tech fee are calculated from tenant settings
4. **Constraints**: Delivery minimum, inventory limits, and group requirements are enforced

The returned `pricedCart` contains the computed totals and is used to create the order.

## Order Creation (`create_order_direct` RPC)

This database function:

1. Validates the tenant is active
2. Determines if the customer is first-time
3. Creates the `orders` record with:
   - Status: `paid` (payment was collected elsewhere)
   - Payment status: `paid`
   - Fulfillment type: `delivery` or `pickup`
   - All customer, delivery, and pricing information
   - Auto-generated `tracking_token` for guest access

4. Creates `order_items` records with line item snapshots
5. Creates `order_item_modifiers` records for each modifier
6. Creates `deliveries` record (status: `unassigned`) for delivery orders
7. Enqueues outbound webhook events to GoHighLevel:
   - `order.created`
   - `order.first_time_customer` (if applicable)

Returns: `{ order_id, tracking_token }`

## Auto-Dispatch Flow

After the order is created, `autoDispatch()` is called:

1. **Determine courier provider**:
   - Check `tenant_secrets` for configured courier credentials
   - Prefer Uber Direct if available, fall back to Shipday
   - Return error if no courier is configured

2. **Validate dispatch prerequisites**:
   - Order must be a delivery order
   - Delivery address must be complete
   - Restaurant address must be configured in settings
   - Restaurant phone number must be configured

3. **Dispatch to provider**:
   - **Uber Direct**: Request quote → dispatch delivery → record reference
   - **Shipday**: Invoke edge function with order ID

4. **Record dispatch result**:
   - On success: Update `deliveries` with `external_ref`, `provider`, `status`, and courier info
   - On failure: Update `deliveries.failure_reason` so staff can retry manually

### Idempotency

If the order already has a delivery reference, dispatch returns the existing one without making a new courier request. This ensures retries are safe.

## Courier Integration

### Uber Direct

**Configuration**:
- Platform credentials: `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET` (Vercel env)
- Per-restaurant: `uber_customer_id` (stored in `tenant_secrets`)

**Dispatch process**:
1. Request a delivery quote (short-lived, ~15 min)
2. Dispatch with quote ID + pickup/dropoff details
3. Receive `delivery_id` and optional tracking URL
4. Record dispatch reference via `record_dispatch_reference()` RPC

**Error handling**:
- Missing credentials → return "not configured" (manual dispatch later)
- Address out of service → return error message to client
- No couriers available → return retryable error
- API errors → log, record failure reason, mark order for manual dispatch

### Shipday

**Configuration**:
- Per-restaurant: `shipday_api_key` (stored in `tenant_secrets`)

**Dispatch process**:
1. Invoke `shipday-dispatch` edge function with `orderId`
2. Edge function handles auth + API call
3. Record dispatch reference via returned job reference

**Error handling**:
- Missing API key → return "not configured"
- API errors → log, record failure reason
- Edge function errors → return error message

## Customer Tracking

Customers access their order via the tracking token:

**URL**: `/orders/{tracking_token}`

The tracking page shows:
- Order status and timeline
- Delivery address and instructions
- Driver info (name, phone) and live location (if assigned)
- Order items, pricing breakdown, and total
- Estimated delivery time

The tracking endpoint (`/api/dispatch/track`) is accessible via:
- RPC `get_delivery_tracking(order_id, token)` with RLS checks
- No customer auth required; only the tracking token is validated

## Error Scenarios

### Missing Prerequisites

- **Restaurant not configured**: Message guides staff to add address/phone in settings
- **No courier configured**: Message guides staff to add courier credentials
- **Kitchen paused**: Order creation is rejected at the pricing stage

### Dispatch Failures

- **Address undeliverable**: Error message returned to client; they can retry or contact support
- **No couriers available**: Retryable error; client can retry (exponential backoff recommended)
- **Courier API down**: Marked for manual dispatch; order is still placed
- **Dispatch saved but DB failed**: Error message tells client to contact support (order exists but delivery status may be stale)

### Idempotency

- **Duplicate request**: Same order ID returned with existing tracking token
- **Webhook redelivery**: If Supabase processes a retry of the same order creation, the RPC returns the existing order ID

## Testing

### Unit Tests

The auto-dispatch logic has tests for:
- Order not found
- Pickup orders (not auto-dispatched)
- No provider configured

Run: `npm test`

### SQL Tests

The RPC functions have SQL-level tests:

Run: `npm run test:sql`

### Integration

To test the full flow:

1. Create a checkout session or call `/api/orders/create`
2. Verify order appears in the KDS
3. Verify delivery record is created with status `unassigned`
4. Check logs for auto-dispatch attempt:
   - Success: "dispatched to [provider]"
   - Skipped: "No courier configured"

## Database Schema

### Core Tables

- `orders`: Order record with status, customer, pricing
- `order_items`: Line item snapshots
- `order_item_modifiers`: Modifier selections
- `deliveries`: Courier dispatch record (provider-agnostic)
- `order_status_events`: Status change audit trail
- `webhook_events`: Outbound events to GoHighLevel (outbox pattern)

### Key Indexes

- `orders_tenant_status_idx`: KDS board queries
- `deliveries_external_ref_key`: Webhook deduplication by provider + external ID
- `webhook_events_queue_idx`: Event drainage by next_attempt_at

## Future Enhancements

- [ ] Pickup orders: Currently not auto-dispatched; can add local SMS notification
- [ ] Promotions: Cart pricing already supports discounts; UI integration pending
- [ ] Payment capture: Stripe re-enabled with separate payment flow
- [ ] Advanced dispatch: Time windows, multiple courier selection, customer communication preferences
- [ ] Delivery analytics: Average times, cancellation rates, performance scoring
