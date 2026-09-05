# Uber Direct Integration Setup

## Status: Production Ready
- ✓ Auto-dispatch implemented
- ✓ Webhook handler deployed
- ⏳ Configuration & testing required

## Prerequisites

1. **Uber Direct Business Account** with API credentials
   - Client ID
   - Client Secret
   - Webhook Signing Secret

2. **vardr-upload-test tenant** with:
   - ✓ uber_customer_id configured (already done)
   - Restaurant address in settings
   - Support phone number

## Step 1: Set Webhook Signing Secret (SAFE)

This environment variable enables webhook signature verification. Setting it does NOT change any delivery behavior—only enables validation when webhooks arrive.

```bash
# In Vercel or local .env.production
UBER_WEBHOOK_SECRET=<your-webhook-signing-secret-from-uber>
```

**Rollback:** Remove the env var. Webhooks will be ignored until redeployed.

## Step 2: Register Webhook in Uber API Console

**Endpoint URL:**
```
https://admin.order.vardrsystems.com/api/webhooks/uber/delivery
```

**Events to subscribe:**
- `delivery.created`
- `delivery.status_changed`
- `delivery.cancelled`
- `delivery.completed`

**In Uber Console:**
1. Go to Settings → Webhooks
2. Add webhook endpoint
3. Paste URL above
4. Copy signing secret to UBER_WEBHOOK_SECRET
5. Test delivery (creates test event)
6. Verify 200 response

**Rollback:** Delete webhook from Uber console. No code changes needed.

## Step 3: Safe End-to-End Test

**Test Environment:** vardr-upload-test (demo tenant, sandbox mode)

**Test Checklist:**

1. **Verify Configuration**
   - Check tenant has uber_customer_id: ✓ (already confirmed)
   - Check tenant has restaurant address: ___ (verify in admin)
   - Check Support Phone is set: ___ (verify in tenant settings)

2. **Place Test Order**
   - Endpoint: POST `/api/orders/create`
   - Use vardr-upload-test subdomain
   - Delivery order with customer address
   - Expected: Order created with status='paid'

3. **Verify Dispatch**
   - Check deliveries table for order_id
   - Confirm external_ref is set (Uber delivery ID)
   - Confirm provider='uber_direct'
   - Confirm status is not 'failed'

4. **Verify Webhook Received**
   - Manually send test webhook from Uber console
   - Check Vercel logs for "[uber-webhook] Delivery updated"
   - Confirm order status advanced (e.g., 'out_for_delivery' if webhook was 'en_route')

5. **Monitor for 24 Hours**
   - Watch Vercel logs for errors
   - Check Supabase for delivery status updates
   - Verify no customer-facing issues

## Step 4: Activate for Production (When Ready)

Once sandbox testing passes:

1. Configure production Uber credentials in tenant_secrets
2. Change fulfillment_type to 'delivery' for real orders
3. Monitor first 10 deliveries closely
4. Scale up

## Rollback Plan (If Issues Arise)

**Option A: Disable Dispatch (Immediate, Safe)**
```sql
UPDATE tenant_settings
SET accepts_delivery = false
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'vardr-upload-test');
```
This prevents new dispatch attempts without reverting code.

**Option B: Revert Webhook Handler (Full Rollback)**
```bash
git revert ec2278a  # Revert webhook commit
git revert ec2278a~1  # Revert handler commit
vercel deploy --prod
```
Webhooks will error (no endpoint), but dispatch continues.
Revert takes ~2 min to deploy.

**Option C: Emergency Disable Uber (Nuclear Option)**
Remove `uber_customer_id` from tenant_secrets:
```sql
DELETE FROM tenant_secrets
WHERE key = 'uber_customer_id'
AND tenant_id = (SELECT id FROM tenants WHERE slug = 'vardr-upload-test');
```
All new orders will fail to dispatch. 
Requires re-entry of customer ID to re-enable.

## Testing Logs to Watch

**Successful dispatch:**
```
[dispatch] Auto-dispatch success: uber_direct / delivery-uuid
[dispatch] Dispatched but not recorded (expected if DB update fails)
```

**Webhook received:**
```
[uber-webhook] Delivery updated: delivery-id picked_up
```

**Errors to investigate:**
```
[dispatch] Auto-dispatch failed: <reason>
[uber-webhook] Invalid signature
[uber-webhook] Delivery not found
```

## Success Criteria

✓ Order placed → Dispatch created in <5 seconds
✓ Uber webhook received within 30 seconds of dispatch
✓ Order status updated to out_for_delivery when en_route
✓ No 500 errors in Vercel logs
✓ No delivery failures for valid addresses

## Production Cutover

After 24h sandbox success:
1. Update production Uber credentials
2. Enable delivery for production tenants
3. Monitor first week closely
4. Scale up delivery offerings

