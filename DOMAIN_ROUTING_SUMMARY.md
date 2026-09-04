# Domain Routing Fix — Complete Summary

## What Was Fixed

The custom domain `order.vardros.com` was rewriting ALL requests to the storefront surface (`/store/*`), preventing access to administrative routes like `/login` and `/app/settings`. This blocked restaurant owners from accessing their dashboard on their own domain.

## Changes Made

### 1. Proxy Routing Logic (`src/proxy.ts`)

**Before:**
```typescript
// ALL paths rewritten to /store, including /app, /login, /admin
return applyCookies(rewrite(request, `/store${pathname === '/' ? '' : pathname}`, requestHeaders));
```

**After:**
```typescript
// Allow staff paths to pass through without rewriting
const isStaffPath = pathname.startsWith('/app') || pathname.startsWith('/login') || pathname.startsWith('/admin');
if (isStaffPath) {
  return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
}

// Only storefront paths rewritten to /store
return applyCookies(rewrite(request, `/store${pathname === '/' ? '' : pathname}`, requestHeaders));
```

### 2. Tenant Activation Migration

Created `supabase/migrations/20260904000100_activate_test_tenant.sql` to transition the test tenant from `pending` to `active` status.

### 3. Activation Script

Created `/tmp/activate-tenant.js` for easy tenant activation via the RPC.

## How It Works

| Path Type | Custom Domain | Subdomain | Behavior |
|-----------|---------------|-----------|----------|
| Storefront | `/` | `/joes` | ✅ Rewritten to `/store` |
| Storefront | `/menu` | `/joes/menu` | ✅ Rewritten to `/store/menu` |
| Storefront | `/orders/{token}` | `/joes/orders/{token}` | ✅ Rewritten to `/store/orders/{token}` |
| **Staff** | `/login` | `/app/login` | ✅ NOT rewritten (auth required) |
| **Staff** | `/app/settings` | `/app/app/settings` | ✅ NOT rewritten (auth required) |
| **Admin** | `/admin` | `/admin` | ✅ NOT rewritten (auth required) |
| **API** | `/api/*` | `/api/*` | ✅ NOT rewritten (passed through) |

## Security

✅ **No security regression:**
- Staff route access still requires authentication
- Tenant context headers still passed and verified
- Authorization checks still happen server-side in layouts
- Service role keys never exposed in routing logic
- RLS policies still enforce tenant isolation

## Testing

### Build & Tests
```bash
✓ npm run build → Success (no errors)
✓ npm run test → 272/272 tests passing
✓ TypeScript: 0 errors
✓ ESLint: 0 errors
```

### Routing Verification
```bash
# Local test with:
npm run dev

# Then test:
curl -H "Host: order.localhost" http://localhost:3000/login
# Expected: HTML login form (not storefront)
```

## Deployment Checklist

### Phase 1: Deploy Routing Fix
- [x] Code change verified (`src/proxy.ts`)
- [x] Build passes with no errors
- [x] All tests pass (272/272)
- [x] Code review ready
- [ ] Push to main and deploy to Vercel
- [ ] Verify deployment succeeded

### Phase 2: Activate Test Tenant
- [ ] Get Supabase service role key
- [ ] Run activation script: `node /tmp/activate-tenant.js vardr-upload-test`
- [ ] Verify status changed to `active`
- [ ] Clear proxy cache (wait 60s or restart)

### Phase 3: End-to-End Testing
- [ ] Test storefront at `https://order.vardros.com/`
- [ ] Test login at `https://order.vardros.com/login` (NOT rewritten)
- [ ] Test dashboard at `https://order.vardros.com/app/settings` (NOT rewritten)
- [ ] Test no errors in browser console
- [ ] Test no errors in Vercel logs

## Files Changed

```
src/proxy.ts
├── Added staff path check (lines 305-315)
├── Prevents /app, /login, /admin from being rewritten to /store
└── Maintains tenant context headers on all requests

supabase/migrations/20260904000100_activate_test_tenant.sql
├── Marks menu as verified
├── Calls activate_storefront RPC
└── Logs the activation for audit trail

DOMAIN_ROUTING_FIX.md (new)
├── Problem analysis
├── Solution explanation
└── Testing instructions

DEPLOYMENT_STEPS.md (new)
├── Phase-by-phase deployment guide
├── Troubleshooting steps
└── Rollback procedures
```

## Key Points

1. **No Breaking Changes:** Subdomain routing (`.joes.localhost`) unaffected
2. **Backward Compatible:** Existing storefront URLs still work
3. **Staff Access Restored:** Dashboard now accessible on custom domains
4. **Security Maintained:** All auth checks still enforced server-side
5. **Test Coverage:** All 272 tests pass, including proxy routing tests

## What Needs to Happen Next

1. **Deploy to Production:**
   ```bash
   git add src/proxy.ts
   git commit -m "fix(proxy): allow staff routes on custom domains"
   git push origin main
   # Vercel auto-deploys
   ```

2. **Activate Test Tenant:**
   ```bash
   export SUPABASE_SERVICE_ROLE_KEY="..."
   node /tmp/activate-tenant.js vardr-upload-test
   ```

3. **Test in Browser:**
   - `https://order.vardros.com/` → Storefront menu
   - `https://order.vardros.com/login` → Login form
   - `https://order.vardros.com/app/settings` → Owner dashboard

## Status

| Component | Status | Evidence |
|-----------|--------|----------|
| Code change | ✅ Ready | `src/proxy.ts` modified |
| Build | ✅ Passing | `npm run build` succeeds |
| Tests | ✅ Passing | 272/272 tests pass |
| Deployment | ⏳ Pending | Awaiting push to main |
| Tenant activation | ⏳ Pending | Awaiting service role key |
| E2E testing | ⏳ Pending | After activation |

## Questions?

See `DOMAIN_ROUTING_FIX.md` for technical details or `DEPLOYMENT_STEPS.md` for step-by-step procedures.
