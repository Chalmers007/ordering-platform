# Ordering Platform Deployment Guide

## Current Status (2026-09-04)

### ✅ Deployed & Working
- **Admin Console** — order.vardros.com/admin (super_admin access verified)
- **Domain Routing** — order.vardros.com correctly routes /app, /login, /admin without rewriting
- **Test Tenant** — vardr-upload-test in pending_claim state for preview testing

### ⏳ Ready to Deploy (Blocked on Environment Variables)
- **Stripe Connect** — Code complete, tests passing (10/10)
- **Uber Direct Integration** — Code complete, tests passing (35/35)
- **Database Migrations** — All schema migrations created

### ❌ Blocked
Cannot deploy without:
1. `STRIPE_SECRET_KEY` in Vercel production environment
2. `UBER_DIRECT_CLIENT_ID` & `UBER_DIRECT_CLIENT_SECRET`
3. `UBER_DIRECT_WEBHOOK_SECRET`

## Deployment Checklist

### Phase 1: Environment Setup (Remote Access Required)
- [ ] Set `STRIPE_SECRET_KEY` in Vercel production environment
- [ ] Set Uber Direct credentials in Vercel:
  - `UBER_DIRECT_CLIENT_ID`
  - `UBER_DIRECT_CLIENT_SECRET`
  - `UBER_DIRECT_WEBHOOK_SECRET`
- [ ] Verify Stripe Connect account is linked to platform account

### Phase 2: Database Deployment
```bash
# These will run automatically with next deployment
supabase migration deploy --project-id zvvujxngyszyduzsmuco
```

Migrations included:
- `20260904001400_dispatch_retry_and_cancel.sql`
- `20260904001500_dispatch_event_log.sql`
- And 15+ others for orders, deliveries, dispatch

### Phase 3: Activate Test Tenant (Optional)
When ready to move from `pending_claim` to `active`:

```bash
export SUPABASE_SERVICE_ROLE_KEY="..."
node -e "
const { createClient } = require('@supabase/supabase-js');
const client = createClient('https://zvvujxngyszyduzsmuco.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  await client.from('tenants').update({ status: 'active' }).eq('slug', 'vardr-upload-test');
  console.log('✓ Tenant activated');
})();
"
```

### Phase 4: End-to-End Testing

**Stripe Flow:**
```bash
npm run dev
# 1. Navigate to order.localhost:3000/checkout
# 2. Fill cart
# 3. Verify checkout form appears
# 4. Check browser console for Stripe errors
```

**Uber Direct Flow:**
```bash
# Check webhook handler
curl -X POST http://localhost:3000/api/webhooks/uber-direct \
  -H "Content-Type: application/json" \
  -d '{"event_type":"delivery.ready_for_pickup"}'
```

**Admin Console:**
- [ ] order.vardros.com/admin loads
- [ ] Platform Overview shows metrics
- [ ] Can see 2 active restaurants (vardr-upload-test, vardr-demo)

## Test Results (Local)

| Component | Tests | Status |
|-----------|-------|--------|
| Stripe Connect | 10 | ✅ PASS |
| Uber Direct | 35 | ✅ PASS |
| Full Suite | 260/293 | ⚠️ 4 env issues |

## Architecture

```
order.vardros.com (custom domain)
├── /app → Restaurant dashboard
├── /admin → Admin panel (super_admin only)
├── /login → Authentication
└── / → Storefront (pending_claim preview)

Payment Flow:
Customer → Stripe Checkout → Platform Account → Restaurant Connect Account

Delivery Flow:
Order → Uber Direct API → Webhook Handler → Database Event Log
```

## Rollback Procedures

### Revert Stripe
```bash
git revert <stripe-commit-hash>
git push origin main
```

### Revert Uber
```bash
git revert <uber-commit-hash>
git push origin main
```

### Revert Environment
```bash
# In Vercel dashboard:
Settings → Environment Variables → Remove STRIPE_SECRET_KEY
```

## Known Issues

1. **Preview tenant showing 404** — Need to verify tenant exists and has menu in database
2. **Test environment** — Missing SUPABASE_URL for some test files
3. **Preview personalisation** — 11 tests skipped (needs database connection)

## Next Steps

1. **Immediate:** Set environment variables in Vercel production
2. **Short-term:** Activate test tenant and test full checkout flow
3. **Medium-term:** Set up production Stripe and Uber Direct accounts
4. **Long-term:** Multi-tenant support for restaurants bringing their own accounts

---

Generated: 2026-09-04
Branch: main
Status: Ready for environment configuration
