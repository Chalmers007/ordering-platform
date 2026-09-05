# Dispatch Alerting Setup

## Overview

Alerts notify on-call engineers of dispatch failures, stuck deliveries, and system health issues.

## Alert Thresholds & Rules

### Critical Alerts (Page immediately)

#### 1. Dispatch Success Rate < 85% (15-minute window)

**Severity**: CRITICAL  
**Impact**: Majority of orders not being dispatched  
**Response Time**: 10 minutes

**Query**:
```sql
SELECT 
  ROUND(100.0 * COUNT(CASE WHEN event_type = 'dispatch_succeeded' THEN 1 END) / 
    COUNT(CASE WHEN event_type IN ('dispatch_succeeded', 'dispatch_failed') THEN 1 END), 2) as success_rate
FROM dispatch_events
WHERE created_at > now() - interval '15 minutes'
AND event_type IN ('dispatch_succeeded', 'dispatch_failed');
```

**Threshold**: < 85%  
**Action**: 
1. Check Uber API status
2. Verify credentials in tenant_secrets
3. Check network connectivity
4. Review error messages in dispatch_events

---

#### 2. Webhook Failures > 50 in 1 hour

**Severity**: CRITICAL  
**Impact**: Real-time delivery status not updating  
**Response Time**: 10 minutes

**Query**:
```sql
SELECT COUNT(*) as webhook_errors
FROM webhook_events
WHERE provider = 'uber_direct'
AND status = 'error'
AND created_at > now() - interval '1 hour';
```

**Threshold**: > 50  
**Action**:
1. Verify webhook URL in Uber Dashboard
2. Check HMAC secret configuration
3. Review webhook_events error messages
4. Test signature verification manually

---

#### 3. Retry Queue Exhausted Deliveries > 5

**Severity**: HIGH  
**Impact**: Orders stuck; manual intervention required  
**Response Time**: 30 minutes

**Query**:
```sql
SELECT COUNT(*) as exhausted_deliveries
FROM deliveries
WHERE status = 'unassigned'
AND attempts >= 5;
```

**Threshold**: > 5  
**Action**:
1. Investigate why retries exhausted (see dispatch_events)
2. Contact Uber support if API issues
3. Create manual dispatch records for affected orders
4. Notify customer support for customer communication

---

### High Priority Alerts (Notify within 1 hour)

#### 4. Dispatch Success Rate < 90% (1-hour window)

**Severity**: HIGH  
**Impact**: Elevated failure rate requiring attention  

**Query**:
```sql
SELECT 
  ROUND(100.0 * COUNT(CASE WHEN event_type = 'dispatch_succeeded' THEN 1 END) / 
    COUNT(CASE WHEN event_type IN ('dispatch_succeeded', 'dispatch_failed') THEN 1 END), 2) as success_rate
FROM dispatch_events
WHERE created_at > now() - interval '1 hour'
AND event_type IN ('dispatch_succeeded', 'dispatch_failed');
```

**Threshold**: < 90%  
**Action**:
1. Review error patterns in dispatch_events
2. Check Uber API rate limiting status
3. Verify no credential rotation issues
4. Monitor for resolution

---

#### 5. Pending Retries > 20

**Severity**: MEDIUM  
**Impact**: Many deliveries awaiting retry  

**Query**:
```sql
SELECT COUNT(*) as pending_retries
FROM deliveries
WHERE status = 'unassigned'
AND next_retry_at <= now()
AND attempts < 5;
```

**Threshold**: > 20  
**Action**:
1. Trigger manual retry: `/api/admin/dispatch/retry`
2. Investigate if Uber API is experiencing issues
3. Check network latency

---

#### 6. Delivery Status Stuck for 4+ hours

**Severity**: HIGH  
**Impact**: Customer delivery not progressing  

**Query**:
```sql
SELECT 
  id,
  order_id,
  status,
  updated_at,
  EXTRACT(EPOCH FROM (now() - updated_at)) / 3600 as hours_since_update
FROM deliveries
WHERE status IN ('assigned', 'picked_up', 'en_route')
AND updated_at < now() - interval '4 hours'
LIMIT 10;
```

**Threshold**: Any result  
**Action**:
1. Check webhook_events for delivery_id to see if updates received
2. Contact Uber support if delivery legitimately taking too long
3. Offer customer alternative (refund, reschedule)

---

### Informational Alerts (Dashboard only)

#### 7. Daily Dispatch Summary

**Frequency**: Daily at 9 AM PT  
**Channels**: Slack #dispatch-ops

**Query**:
```sql
SELECT
  DATE(created_at) as date,
  COUNT(CASE WHEN event_type = 'dispatch_succeeded' THEN 1 END) as succeeded,
  COUNT(CASE WHEN event_type = 'dispatch_failed' THEN 1 END) as failed,
  ROUND(100.0 * COUNT(CASE WHEN event_type = 'dispatch_succeeded' THEN 1 END) /
    NULLIF(COUNT(CASE WHEN event_type IN ('dispatch_succeeded', 'dispatch_failed') THEN 1 END), 0), 2) as success_rate,
  COUNT(DISTINCT order_id) as unique_orders,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_duration_sec
FROM dispatch_events
WHERE created_at >= now()::date
GROUP BY DATE(created_at);
```

---

## Alert Destinations

### Slack Integration

1. **Channel**: #dispatch-ops
   - Critical & High alerts
   - Daily summary

2. **Channel**: #incidents
   - Routing for critical page-worthy alerts

3. **DM**: On-call engineer
   - Critical alerts with phone call

### PagerDuty Integration (Future)

- Escalation policy: Tier 1 → Tier 2 after 15 min
- Escalation policy: Tier 2 → Manager after 30 min

---

## Implementation with Supabase Webhooks

### 1. Create Alert Function

```sql
CREATE OR REPLACE FUNCTION check_dispatch_alerts()
RETURNS void AS $$
DECLARE
  success_rate NUMERIC;
  webhook_errors INT;
  exhausted_count INT;
  pending_retries INT;
BEGIN
  -- Check dispatch success rate
  SELECT ROUND(100.0 * COUNT(CASE WHEN event_type = 'dispatch_succeeded' THEN 1 END) /
    COUNT(CASE WHEN event_type IN ('dispatch_succeeded', 'dispatch_failed') THEN 1 END), 2)
  INTO success_rate
  FROM dispatch_events
  WHERE created_at > now() - interval '15 minutes'
  AND event_type IN ('dispatch_succeeded', 'dispatch_failed');

  IF success_rate < 85 THEN
    PERFORM http_post('https://alerts.example.com/webhook', 
      jsonb_build_object(
        'alert', 'dispatch_success_rate_critical',
        'value', success_rate,
        'threshold', 85
      )::text
    );
  END IF;

  -- Check webhook errors
  SELECT COUNT(*) INTO webhook_errors
  FROM webhook_events
  WHERE provider = 'uber_direct'
  AND status = 'error'
  AND created_at > now() - interval '1 hour';

  IF webhook_errors > 50 THEN
    PERFORM http_post('https://alerts.example.com/webhook',
      jsonb_build_object(
        'alert', 'webhook_errors_critical',
        'value', webhook_errors,
        'threshold', 50
      )::text
    );
  END IF;

  -- Check exhausted deliveries
  SELECT COUNT(*) INTO exhausted_count
  FROM deliveries
  WHERE status = 'unassigned'
  AND attempts >= 5;

  IF exhausted_count > 5 THEN
    PERFORM http_post('https://alerts.example.com/webhook',
      jsonb_build_object(
        'alert', 'retry_exhausted',
        'value', exhausted_count,
        'threshold', 5
      )::text
    );
  END IF;

  -- Check pending retries
  SELECT COUNT(*) INTO pending_retries
  FROM deliveries
  WHERE status = 'unassigned'
  AND next_retry_at <= now()
  AND attempts < 5;

  IF pending_retries > 20 THEN
    PERFORM http_post('https://alerts.example.com/webhook',
      jsonb_build_object(
        'alert', 'pending_retries_high',
        'value', pending_retries,
        'threshold', 20
      )::text
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
```

### 2. Schedule Alert Checker

```sql
SELECT cron.schedule('check-dispatch-alerts', '*/5 * * * *', 'SELECT check_dispatch_alerts()');
```

---

## Slack Bot Integration

Create a Slack bot to post alerts:

```python
# alerts_bot.py
import os
import json
from slack_sdk import WebClient
from supabase import create_client

slack = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

def check_dispatch_health():
    """Check dispatch health and alert if needed."""
    
    # Success rate check
    response = db.table("dispatch_events").select("event_type").gte(
        "created_at", "now() - interval 15 minutes"
    ).execute()
    
    events = response.data
    succeeded = sum(1 for e in events if e["event_type"] == "dispatch_succeeded")
    failed = sum(1 for e in events if e["event_type"] == "dispatch_failed")
    rate = (succeeded / (succeeded + failed) * 100) if (succeeded + failed) > 0 else 100
    
    if rate < 85:
        slack.chat_postMessage(
            channel="#dispatch-ops",
            text=f":warning: CRITICAL: Dispatch success rate is {rate:.1f}%"
        )
    elif rate < 90:
        slack.chat_postMessage(
            channel="#dispatch-ops",
            text=f":yellow_circle: HIGH: Dispatch success rate is {rate:.1f}%"
        )

if __name__ == "__main__":
    check_dispatch_health()
```

---

## Monitoring Dashboard

### Grafana (Recommended)

Create Grafana dashboard with panels:

1. **Dispatch Success Rate** (gauge)
   - Query: Success rate over last hour
   - Threshold: Red <85%, Yellow <90%

2. **Delivery Status Breakdown** (pie chart)
   - Query: COUNT(*) GROUP BY status

3. **Retry Queue** (stat)
   - Query: COUNT(*) WHERE status='unassigned' AND attempts<5

4. **Webhook Events** (time series)
   - Query: COUNT(*) per minute GROUP BY status

5. **Error Messages** (table)
   - Query: Top error messages in last 24h

### Vercel Edge Function Logs

Monitor real-time via Vercel dashboard:
- URL: https://vercel.com/connectentinc-2161s-projects/ordering-platform
- Filter: `[dispatch]`, `[webhook]`, `[uber]`

---

## Runbook Templates

### Dispatch Success Rate < 85%

**Duration**: 10-15 min  
**Steps**:
1. Verify Uber API status: https://status.uber.com
2. Check credentials:
   ```sql
   SELECT * FROM tenant_secrets WHERE key LIKE 'uber%' AND tenant_id='...';
   ```
3. Tail logs for errors:
   ```bash
   vercel logs -f | grep -i dispatch
   ```
4. If persistent, contact Uber support

---

### Webhook Failures > 50

**Duration**: 15-20 min  
**Steps**:
1. Verify webhook URL in Uber Dashboard
2. Test signature verification:
   ```bash
   # Manually call webhook with test data
   ```
3. Check webhook_events table for patterns:
   ```sql
   SELECT error, COUNT(*) FROM webhook_events GROUP BY error;
   ```
4. If all signatures failing, credential may have rotated

---

## Testing Alerts

### Trigger Test Alert

```sql
-- Insert test dispatch failure event
INSERT INTO dispatch_events (
  tenant_id, order_id, delivery_id, event_type, 
  status, error_message, provider, created_at
)
VALUES (
  'test-tenant', 'test-order', 'test-delivery', 
  'dispatch_failed', 'failed', 'Test alert trigger', 
  'uber_direct', now()
);
```

### Simulate Webhook Failure

```bash
# Test webhook endpoint with invalid signature
curl -X POST https://ordering-platform.com/api/webhooks/uber-delivery \
  -H "X-Uber-Signature: sha256=invalid" \
  -H "Content-Type: application/json" \
  -d '{"delivery_id":"test"}'
```

---

## On-Call Escalation

**Level 1 (On-Call Engineer)**
- Page on CRITICAL alerts
- Response time: 10 minutes
- Can action: credential rotation, manual retry, customer communication

**Level 2 (Senior Engineer)**
- Escalate if Level 1 unresponsive after 15 min
- Or on repeated failures within 4 hours
- Can action: code changes, Uber support coordination

**Level 3 (Manager)**
- Escalate if Level 2 unresponsive after 30 min
- Or on customer-impacting outage >1 hour
- Can action: customer communication, public status page update

---

## Alert Maintenance

- [ ] Review alert thresholds monthly (after seeing 1+ incidents)
- [ ] Update runbooks as new issues discovered
- [ ] Disable alerts for false positives
- [ ] Add new alerts as patterns emerge
- [ ] Test alert integrations quarterly
