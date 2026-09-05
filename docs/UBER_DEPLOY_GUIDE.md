# Uber Direct Production Deployment Guide

## Pre-Deployment Checklist (48 hours before)

### 1. Credentials & Configuration

- [ ] Uber production Customer ID obtained from Business Account
- [ ] Uber production API key generated and stored securely
- [ ] HMAC webhook secret generated (32+ random characters)
- [ ] Test credentials validated in sandbox environment

### 2. Database Preparation

- [ ] Backup production database
- [ ] Review pending migrations:
  - `20260904001400_dispatch_retry_and_cancel.sql`
  - `20260904001500_dispatch_event_log.sql`
- [ ] Test migrations on staging database
- [ ] Prepare rollback plan (see Rollback section)

### 3. Vercel Configuration

- [ ] Production environment variables prepared:
  ```env
  UBER_API_KEY=prod_key_xxx
  UBER_API_URL=https://api.uber.com/v1
  UBER_WEBHOOK_SECRET=secret_xxx
  ```
- [ ] Variables reviewed for correctness
- [ ] Webhook URL configured: `https://ordering-platform.com/api/webhooks/uber-delivery`

### 4. Monitoring Setup

- [ ] Alerting configured for dispatch failures
- [ ] Dashboard created for dispatch metrics
- [ ] On-call rotation assigned
- [ ] Support team trained on troubleshooting

---

## Deployment Steps

### Step 1: Prepare Code (30 minutes)

```bash
# Ensure latest code is committed and pushed
git log --oneline | head -5

# Verify no uncommitted changes
git status

# Confirm migrations are in supabase/migrations/
ls -la supabase/migrations/20260904001*.sql
```

### Step 2: Merge and Deploy (60 minutes)

1. **Create release branch**:
   ```bash
   git checkout -b deploy/uber-direct-prod
   git cherry-pick <commit-hashes>  # Include dispatch Phase 1-4
   ```

2. **Verify builds**:
   ```bash
   npm run build
   npm run test  # Run dispatch tests
   ```

3. **Deploy to Vercel**:
   ```bash
   vercel deploy --prod
   ```

4. **Verify deployment**:
   ```bash
   curl https://ordering-platform.com/api/health
   ```

### Step 3: Migrate Database (30 minutes)

**WARNING**: Migrations are applied in order. If one fails, all subsequent ones are blocked.

1. **Apply migrations via Vercel postgres CLI**:
   ```bash
   npx supabase migration up
   ```

2. **Verify migration status**:
   ```sql
   SELECT version, name, installed_on 
   FROM supabase.migrations 
   ORDER BY version DESC 
   LIMIT 10;
   ```

3. **Check new tables/columns**:
   ```sql
   -- Verify deliveries table has new columns
   \d deliveries  
   
   -- Verify dispatch_events table exists
   \d dispatch_events
   ```

### Step 4: Deploy Webhook Configuration (10 minutes)

1. **Log in to Uber Delivery Dashboard**
2. **Navigate**: Settings → Webhooks
3. **Add webhook URL**:
   ```
   https://ordering-platform.com/api/webhooks/uber-delivery
   ```
4. **Set events to subscribe**:
   - `delivery.status_update`
5. **Test webhook**:
   ```bash
   # Uber provides test button in Dashboard
   # Also test manually:
   curl -X POST https://ordering-platform.com/api/webhooks/uber-delivery \
     -H "X-Uber-Signature: sha256=test_sig" \
     -H "Content-Type: application/json" \
     -d '{"event_type":"delivery_status","status":"picked_up"}'
   ```

### Step 5: Store Tenant Credentials (15 minutes)

Update tenant configuration for production tenant:

```sql
-- Enable uber_direct for tenant
UPDATE tenants 
SET config = jsonb_set(config, '{dispatch_provider}', '"uber_direct"')
WHERE id = 'production-tenant-id';

-- Store Uber customer ID
INSERT INTO tenant_secrets (tenant_id, key, value, encrypted, created_at)
VALUES 
  ('production-tenant-id', 'uber_customer_id', 'cXXXXXXXXXXXXX', true, now())
ON CONFLICT (tenant_id, key) 
DO UPDATE SET value = 'cXXXXXXXXXXXXX', updated_at = now();
```

**Verify credentials stored**:
```sql
SELECT key, encrypted 
FROM tenant_secrets 
WHERE tenant_id = 'production-tenant-id' 
AND key LIKE 'uber%';
```

### Step 6: Smoke Test (30 minutes)

1. **Create test order** (as customer):
   - Place order with delivery address
   - Verify checkout shows delivery fee
   - Confirm order dispatched (check `deliveries` table)

2. **Check delivery status**:
   ```sql
   SELECT id, status, external_ref, attempts, next_retry_at 
   FROM deliveries 
   WHERE order_id = 'test-order-id';
   ```

3. **Verify webhook received**:
   ```sql
   SELECT * FROM dispatch_events 
   WHERE order_id = 'test-order-id' 
   ORDER BY created_at DESC;
   ```

4. **Test tracking page**:
   - Get tracking token from order
   - Visit `/tracking?orderId=xxx&token=yyy`
   - Verify courier details displayed

5. **Check admin metrics**:
   ```bash
   curl https://ordering-platform.com/api/admin/dispatch-health?tenantId=production-tenant-id \
     -H "Authorization: Bearer <super-admin-token>"
   ```

---

## Monitoring Dashboards

### Vercel Dashboard
- URL: https://vercel.com/connectentinc-2161s-projects/ordering-platform
- Key metrics: Deployment status, edge function logs, runtime errors

### Database Monitoring
- RLS policy violations
- Slow queries on `deliveries`, `dispatch_events` tables
- Connection pool saturation

### Custom Dashboard (to create)
```sql
-- Dispatch health view
CREATE VIEW v_dispatch_health_24h AS
SELECT 
  COUNT(*) as total_orders,
  COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  COUNT(CASE WHEN status = 'unassigned' THEN 1 END) as unassigned,
  ROUND(100.0 * COUNT(CASE WHEN status = 'delivered' THEN 1 END) / COUNT(*), 2) as success_rate
FROM deliveries
WHERE created_at > now() - interval '24h';
```

---

## Rollback Plan

### Minor Issues (New deployment has bugs)

1. **Revert Vercel deployment**:
   ```bash
   vercel rollback  # Reverts to previous working deployment
   ```

2. **No database changes needed** (backward compatible)

### Major Issues (Database corruption, data loss)

**Rollback should be rare if migrations tested properly.**

1. **Restore from backup**:
   ```bash
   # Contact Supabase support to restore from point-in-time backup
   # Approximate RPO: 1 hour
   # RTO: ~30 minutes
   ```

2. **Revert code**:
   ```bash
   git revert <merge-commit>
   vercel deploy --prod
   ```

3. **Data reconciliation**:
   - Check for duplicate dispatch entries
   - Verify order statuses match delivery statuses
   - Manual order status corrections if needed

### Prevent Rollback (Best Practices)

- Test migrations on staging database before production
- Use readonly queries before writes
- Small, incremental deployments
- Canary deployment to 10% of users first
- Run load tests before production cutover

---

## Post-Deployment (Day 1)

- [ ] Monitor dispatch success rate every 30 minutes
- [ ] Check logs for errors: `[dispatch]`, `[webhook]`, `[uber]`
- [ ] Verify webhooks are being received
- [ ] Monitor retry queue (should be <5)
- [ ] Alert if success rate drops <90%

### Day 1 Checklist
```bash
# Check deployment stability
vercel logs

# Verify database performance
SELECT COUNT(*) FROM deliveries;
SELECT COUNT(*) FROM dispatch_events;

# Check error rate
SELECT COUNT(*) FROM dispatch_events 
WHERE event_type = 'dispatch_failed' 
AND created_at > now() - interval '24h';
```

---

## Post-Deployment (Week 1)

- [ ] Monitor dispatch metrics daily
- [ ] Review dispatch_events for patterns (common failures)
- [ ] Verify retry queue clears successfully
- [ ] Monitor customer complaints about delivery
- [ ] Adjust alerting thresholds based on actual performance

---

## Support Runbook

### Customer: "Where's my delivery?"

**Steps**:
1. Get order ID from order history
2. Fetch delivery status:
   ```sql
   SELECT status, courier_name, courier_phone, estimated_delivery_at
   FROM deliveries
   WHERE order_id = '...';
   ```
3. Check last webhook update:
   ```sql
   SELECT status, metadata, created_at
   FROM dispatch_events
   WHERE order_id = '...'
   ORDER BY created_at DESC LIMIT 1;
   ```
4. If `unassigned` for >10 minutes:
   - Manual retry: Contact admin dashboard
   - Offer alternative (pickup, reschedule)

### Dispatch Success Rate Dropped to 85%

**Steps**:
1. Check Uber API status: https://status.uber.com
2. Review dispatch_events for patterns:
   ```sql
   SELECT 
     error_message,
     COUNT(*) as count
   FROM dispatch_events
   WHERE event_type = 'dispatch_failed'
   AND created_at > now() - interval '1h'
   GROUP BY error_message
   ORDER BY count DESC;
   ```
3. Check network connectivity to Uber API
4. Verify credentials haven't rotated
5. Contact Uber support if persistent

### "Webhook not updating delivery status"

**Steps**:
1. Verify webhook URL in Uber Dashboard
2. Check webhook logs:
   ```sql
   SELECT COUNT(*) as webhook_received
   FROM webhook_events
   WHERE provider = 'uber_direct'
   AND created_at > now() - interval '1h';
   ```
3. Test webhook signature verification:
   ```bash
   # Manually test with curl
   curl -X POST https://ordering-platform.com/api/webhooks/uber-delivery \
     -H "X-Uber-Signature: sha256=..." \
     -d '{"delivery_id":"..."}'
   ```
4. Check server logs for 401/signature errors

---

## Configuration Variables

### Environment (Vercel)
```env
# Required
UBER_API_KEY=<production-key>
UBER_API_URL=https://api.uber.com/v1
UBER_WEBHOOK_SECRET=<shared-secret>

# Optional (defaults shown)
UBER_DISPATCH_TIMEOUT_MS=30000
UBER_RETRY_BACKOFF_MULTIPLIER=1.5
MAX_DISPATCH_RETRIES=5
```

### Database
- Tenants table: `config.dispatch_provider = 'uber_direct'`
- Tenant secrets: `uber_customer_id`, `uber_api_key`

---

## Success Criteria

Post-deployment, verify:

- [ ] Dispatch success rate ≥ 95%
- [ ] Average dispatch time ≤ 5 minutes
- [ ] Webhook delivery ≥ 99%
- [ ] Customer tracking page loads ≤ 1s
- [ ] No customer complaints about missing deliveries
- [ ] Retry queue clears within 24h backoff window
- [ ] Admin dashboard metrics accurate

---

## Contacts & Escalation

- **Uber API Support**: https://developer.uber.com/support
- **Supabase Support**: https://supabase.com/support
- **On-Call Engineer**: [On-call rotation]
- **Product Manager**: [Contact]

---

## Lessons Learned

Post-mortem checklist (if issues occur):
- [ ] Root cause identified
- [ ] Fix deployed and verified
- [ ] Runbook updated
- [ ] Alert configured to prevent recurrence
- [ ] Team debriefed
