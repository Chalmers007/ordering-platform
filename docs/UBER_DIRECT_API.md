# Uber Direct Integration API

## Overview

Uber Direct delivery integration for the Ordering Platform. Provides automated dispatch, real-time tracking, retry logic, and admin metrics.

## Configuration

### Tenant Setup

1. **Uber Business Account**: Create an Uber Business account with Delivery service enabled.
2. **Sandbox Credentials** (testing): Obtain sandbox Customer ID from Uber Delivery Dashboard.
3. **Production Credentials**: Request production Customer ID after UAT completion.

### Storing Credentials

Credentials are stored in `tenant_secrets` table:

```sql
INSERT INTO tenant_secrets (tenant_id, key, value, encrypted)
VALUES 
  ('tenant-id', 'uber_customer_id', 'customer_xxx', true),
  ('tenant-id', 'uber_api_key', 'key_xxx', true);
```

Store in Vercel environment variables:

```env
UBER_API_KEY=key_xxx
UBER_API_URL=https://sandbox-api.uber.com/v1  # Sandbox
UBER_API_URL=https://api.uber.com/v1            # Production
```

---

## API Endpoints

### 1. Create Delivery Quote (Pre-Checkout)

**Endpoint**: `POST /api/checkout/delivery-quote`

**Purpose**: Calculate delivery fee before order placement.

**Request**:
```json
{
  "tenantId": "vardr-upload-test",
  "dropoffAddress": "123 Main St, San Francisco, CA 94105",
  "dropoffLatitude": 37.7749,
  "dropoffLongitude": -122.4194,
  "deliveryValue": 2500
}
```

**Response** (200 OK):
```json
{
  "feeUsd": 4.50,
  "feeCents": 450,
  "currency": "USD",
  "estimatedDeliveryMinutes": 32,
  "dropoffEta": "2026-09-04T21:15:00Z"
}
```

**Error** (400 Bad Request):
```json
{
  "error": "Missing restaurant address in tenant config"
}
```

**Errors**:
- `400` - Missing tenant config (address, Uber credentials)
- `500` - Uber API timeout or service error
- `null` return - Gracefully fails; order can still be placed without delivery estimate

---

### 2. Create Delivery (On Order)

**Endpoint**: `POST /api/orders/dispatch` (internal server action)

**Purpose**: Dispatch order to Uber when order is created.

**Triggered by**:
- Order status: `paid` → auto-dispatch if delivery enabled

**Process**:
1. Fetch delivery address from order
2. Call Uber API `POST /customers/{customer_id}/deliveries`
3. Store delivery record with external_ref (Uber delivery_id)
4. Update order status to `out_for_delivery` on successful dispatch

**Internal Response**:
```typescript
{
  dispatched: true,
  deliveryId: "uuid",
  uberId: "delivery_xxx",
  eta: "2026-09-04T21:15:00Z"
}
```

**Failure**:
- Delivery created but marked `status: 'unassigned'`
- Retry scheduled via exponential backoff
- No customer-facing error (silent)

---

### 3. Get Delivery Quote (Admin)

**Endpoint**: `GET /api/admin/dispatch-health?tenantId=xxx`

**Purpose**: Admin dashboard metrics for dispatch health.

**Authentication**: Super Admin only

**Response** (200 OK):
```json
{
  "attempted": 145,
  "succeeded": 138,
  "failed": 7,
  "successRate": 95,
  "unassigned": 2,
  "assigned": 12,
  "pickedUp": 8,
  "enRoute": 15,
  "delivered": 108,
  "cancelled": 0,
  "failedCount": 2,
  "avgDispatchTimeMs": 0,
  "avgDeliveryTimeMs": 0,
  "awaitingRetry": 2,
  "retryExhausted": 0
}
```

---

### 4. Order Tracking (Customer-Facing)

**Endpoint**: `GET /api/orders/{orderId}/tracking?token={token}`

**Purpose**: Real-time delivery status for customer.

**Authentication**: Tracking token (no login required)

**Response** (200 OK):
```json
{
  "orderId": "order-123",
  "orderStatus": "out_for_delivery",
  "status": "en_route",
  "courierName": "John D.",
  "courierPhone": "+14155551234",
  "courierLatitude": 37.7749,
  "courierLongitude": -122.4194,
  "estimatedDeliveryAt": "2026-09-04T21:15:00Z",
  "trackingUrl": "https://www.uber.com/tracking/delivery_xxx",
  "lastUpdate": "2026-09-04T21:00:30Z"
}
```

**Errors**:
- `400` - Missing token
- `404` - Order not found or token invalid

---

### 5. Cancel Delivery (On Order Cancellation)

**Endpoint**: `POST /api/orders/{orderId}/cancel` (internal)

**Purpose**: Cancel Uber delivery when customer cancels order.

**Triggered by**:
- Order cancellation before delivery complete

**Process**:
1. Fetch delivery record
2. Check status (can't cancel if delivered/already cancelled)
3. Call Uber API `POST /customers/{customer_id}/deliveries/{delivery_id}/cancel`
4. Update delivery status to `cancelled`
5. Update order status to `cancelled`

**Response**:
```typescript
{
  cancelled: true,
  deliveryId: "uuid",
  uberId: "delivery_xxx"
}
```

---

### 6. Webhook: Delivery Status Updates

**Endpoint**: `POST /api/webhooks/uber-delivery`

**Purpose**: Receive real-time delivery status changes from Uber.

**Authentication**: HMAC-SHA256 signature verification

**Request Header**:
```
X-Uber-Signature: sha256=<base64(hmac_sha256(key, body))>
```

**Body**:
```json
{
  "event_type": "delivery_status",
  "delivery_id": "delivery_xxx",
  "status": "picked_up|en_route|delivered|failed",
  "timestamp": "2026-09-04T21:00:00Z",
  "driver": {
    "name": "John D.",
    "phone": "+14155551234",
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "notes": "Arrived at destination"
}
```

**Response** (200 OK):
```json
{ "received": true }
```

**Process**:
1. Verify HMAC signature
2. Parse delivery_id → order_id
3. Update delivery record with new status + driver info
4. Log event to dispatch_events table
5. Return 200 immediately (async processing)

**Important**: Webhook returns 200 for all requests to prevent Uber retries.

---

## Retry Strategy

### Exponential Backoff

When dispatch fails:

| Attempt | Backoff | Cumulative |
|---------|---------|-----------|
| 1       | 30s     | 30s       |
| 2       | 5m      | 5m 30s    |
| 3       | 30m     | 35m 30s   |
| 4       | 4h      | 4h 35m 30s |
| 5       | 24h     | 28h 35m 30s |

After 5 attempts, delivery is marked `exhausted` and requires manual intervention.

### Manual Retry

Admin can manually trigger retry:

```bash
POST /api/admin/dispatch/retry?tenantId=xxx
```

Response:
```json
{
  "retried": 3,
  "succeeded": 2,
  "failed": 1,
  "errors": [
    { "orderId": "order-456", "reason": "Restaurant closed" }
  ]
}
```

---

## Failure Scenarios

### Order Cancelled Before Dispatch

- Delivery marked `cancelled_at` with reason
- Order status updated to `cancelled`
- Customer refunded if payment processed

### Delivery Pickup Failed

- Status: `failed`
- Reason logged (e.g., "Restaurant closed", "Driver unable to reach")
- Order status reverted to `ready` for pickup
- Customer notified to arrange alternative delivery

### Delivery Lost/Abandoned

- No status update received for >24h
- Retry exhausted
- Alert sent to admin
- Manual intervention required

---

## Event Logging

All dispatch events logged to `dispatch_events` table:

```sql
SELECT 
  event_type,       -- dispatch_created, dispatch_succeeded, delivery_status_updated, etc.
  status,           -- Current status at time of event
  external_ref,     -- Uber delivery_id
  error_message,    -- If failed
  metadata,         -- JSON details
  created_at
FROM dispatch_events
WHERE tenant_id = 'vardr-upload-test'
AND created_at > now() - interval '24h'
ORDER BY created_at DESC;
```

---

## Environment Variables

```env
# Uber API
UBER_API_KEY=<production-key>
UBER_API_URL=https://api.uber.com/v1

# Webhooks
UBER_WEBHOOK_SECRET=<shared-secret>
WEBHOOK_HOST=https://ordering-platform.com

# Database
DATABASE_URL=postgres://...
DATABASE_SERVICE_ROLE_KEY=...
```

---

## Production Deployment Checklist

- [ ] Uber production credentials obtained and verified
- [ ] `tenant_secrets` populated for production tenant
- [ ] Webhook URL registered in Uber Dashboard: `https://ordering-platform.com/api/webhooks/uber-delivery`
- [ ] Database migrations applied: `20260904001400`, `20260904001500`
- [ ] Environment variables set in Vercel
- [ ] Alerting configured for dispatch failures (>10% failure rate)
- [ ] UAT completed with test orders
- [ ] Customer tracking page UI reviewed
- [ ] Support runbook distributed to support team

---

## Monitoring & Alerts

### Key Metrics

- **Dispatch Success Rate**: Target >95%
- **Average Dispatch Time**: <5 minutes
- **Retry Queue**: <5 pending retries
- **Failed Deliveries**: <2% of completed

### Alert Conditions

1. **Success Rate < 90%** (15m window)
   - Action: Check Uber API status, credentials, rate limiting

2. **Retry Queue > 10**
   - Action: Check network/Uber API, consider manual retry

3. **Failed Delivery > 20 in 1h**
   - Action: Investigate reason pattern, contact Uber support

4. **Webhook Failures** (>50 failed verifications in 1h)
   - Action: Check HMAC secret, webhook URL, network

---

## Support & Troubleshooting

### Delivery Stuck in "Unassigned"

1. Check `dispatch_events` for errors:
   ```sql
   SELECT * FROM dispatch_events 
   WHERE order_id = 'order-123' 
   ORDER BY created_at DESC LIMIT 5;
   ```

2. Verify credentials:
   ```sql
   SELECT key, value 
   FROM tenant_secrets 
   WHERE tenant_id = 'vardr-upload-test' 
   AND key LIKE 'uber%';
   ```

3. Manual retry:
   ```bash
   POST /api/admin/dispatch/retry?tenantId=vardr-upload-test
   ```

### Webhook Not Received

1. Verify webhook URL in Uber Dashboard
2. Check webhook logs:
   ```sql
   SELECT * FROM webhook_events 
   WHERE provider = 'uber_direct' 
   ORDER BY created_at DESC LIMIT 10;
   ```

3. Test webhook signature:
   ```bash
   curl -X POST https://localhost:3000/api/webhooks/uber-delivery \
     -H "X-Uber-Signature: sha256=..." \
     -H "Content-Type: application/json" \
     -d '{"event_type":"delivery_status"...}'
   ```

---

## References

- [Uber Direct API Docs](https://developer.uber.com/docs/delivery)
- [OAuth 2.0 Setup](https://developer.uber.com/docs/delivery/guides/authentication)
- Webhook Signature: HMAC-SHA256 of request body
