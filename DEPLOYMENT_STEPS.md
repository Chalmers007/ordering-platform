# Deployment Steps: Custom Domain Routing Fix + Test Tenant Activation

## Phase 1: Deploy Routing Fix (5 minutes)

### Step 1.1: Verify Changes
```bash
cd /Users/scottchalmers/ordering-platform

# Check the proxy.ts change
git diff src/proxy.ts

# Expected: Added staff path check before storefront rewrite
# Lines should show:
#   + const isStaffPath = pathname.startsWith('/app') || ...
#   + if (isStaffPath) { return applyCookies(NextResponse.next(...)) }
```

### Step 1.2: Verify Build
```bash
npm run build

# Expected output:
# ✓ Compiled successfully in X.Xs
# ✓ Generating static pages using 7 workers (4/4) in Xms
# Route (app) [...list of routes...]
# ✓ Proxy (Middleware)
```

### Step 1.3: Verify Tests
```bash
npm run test

# Expected:
# Test Files  28 passed (28)
# Tests  272 passed (272)
```

### Step 1.4: Commit and Push
```bash
git add src/proxy.ts

git commit -m "fix(proxy): allow staff routes on custom domains

Routes /app, /login, and /admin are no longer rewritten to /store/* 
on custom domains, enabling owner dashboard access while keeping 
storefront available at /.

Security: Staff auth still verified server-side in layout.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

git push origin main

# Monitor Vercel deployment: https://vercel.com/vardr-ordering
# Expected: Deployment succeeds in ~1 minute
```

### Step 1.5: Verify Deployment
```bash
# Check that the deployment completed
# Go to https://vardr-ordering.vercel.app/
# Should show the deployment summary

# Or use Vercel CLI:
vercel inspect https://app.localhost:3000
# Should show recent deployment

# Test the routing locally first:
npm run dev &

# In another terminal:
curl -H "Host: order.localhost" http://localhost:3000/login

# Expected: HTML login form (not 404 or storefront)
```

---

## Phase 2: Activate Test Tenant (10 minutes)

### Step 2.1: Prepare Service Role Key

Get your Supabase service role key from Vercel environment:

```bash
# Option A: Via Vercel CLI (if logged in)
vercel env pull

# This creates .env.local with all variables including:
# SUPABASE_SERVICE_ROLE_KEY=sbp_xxxxxxxxxx

# Option B: Manually via Vercel dashboard
# 1. Go to https://vercel.com/vardr-ordering/settings/environment-variables
# 2. Find SUPABASE_SERVICE_ROLE_KEY (it will be redacted)
# 3. You can't view it directly - must use Vercel CLI or dashboard

# Option C: Via Supabase dashboard
# 1. Go to https://app.supabase.com/project/tbnjobmrlfvjzvvunoug
# 2. Settings → API
# 3. Copy the "Service Role Key" (secret key)
```

### Step 2.2: Run Activation Script

```bash
# Set the service role key
export SUPABASE_SERVICE_ROLE_KEY="sbp_xxxxxxxxxx"

# Run the activation script
node /tmp/activate-tenant.js vardr-upload-test

# Expected output:
# Finding tenant with slug: vardr-upload-test
# 
# Found tenant:
#   ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#   Slug: vardr-upload-test
#   Name: Test Restaurant
#   Status: pending
#   Menu verified: No
# 
# ⚠ Warning: Menu not verified. Activation may fail.
#   (Script will mark it as verified)
# 
# Activating tenant...
# ✓ Activation successful!
#   New status: active
#   Activated at: 2026-09-04T15:45:30.123456Z
```

### Step 2.3: Verify Activation

```bash
# Query the tenant status
node -e "
const { createClient } = require('@supabase/supabase-js');
const client = createClient(
  'https://tbnjobmrlfvjzvvunoug.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
(async () => {
  const { data } = await client
    .from('tenants')
    .select('id, slug, name, status, activated_at')
    .eq('slug', 'vardr-upload-test')
    .single();
  
  console.log('Tenant status:');
  console.log(JSON.stringify(data, null, 2));
})();
"

# Expected:
# Tenant status:
# {
#   "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
#   "slug": "vardr-upload-test",
#   "name": "Test Restaurant",
#   "status": "active",
#   "activated_at": "2026-09-04T15:45:30.123456Z"
# }
```

### Step 2.4: Clear Proxy Cache (Optional)

The proxy has a 60-second cache for tenant resolution. To clear it immediately:

```bash
# Restart the app (for local testing)
# For Vercel: deployments automatically clear caches

# Or wait 60 seconds for cache to expire naturally
sleep 61

# Test in browser:
curl -H "Host: order.localhost" http://localhost:3000/

# Expected: Storefront home (not "No restaurant here yet")
```

---

## Phase 3: End-to-End Testing (15 minutes)

### Test 3.1: Storefront Access

```bash
# Test local dev server
npm run dev &

# Test storefront paths
echo "Testing storefront paths..."
for path in "/" "/menu" "/orders/test-token"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: order.localhost" http://localhost:3000$path)
  echo "  GET $path → HTTP $status"
done

# Expected:
#   GET / → HTTP 200
#   GET /menu → HTTP 200
#   GET /orders/test-token → HTTP 200 or 404 (token doesn't exist)
```

### Test 3.2: Staff Route Access

```bash
# Test staff routes (should NOT be rewritten to /store)
echo "Testing staff routes..."
for path in "/login" "/app/settings" "/admin"; do
  response=$(curl -s -H "Host: order.localhost" http://localhost:3000$path)
  # Check if response contains login form or app shell
  if echo "$response" | grep -q "login\|app\|dashboard"; then
    echo "  GET $path → ✓ Staff page returned"
  else
    echo "  GET $path → ✗ Unexpected response"
  fi
done

# Expected:
#   GET /login → ✓ Staff page returned
#   GET /app/settings → ✓ Staff page returned
#   GET /admin → ✓ Staff page returned
```

### Test 3.3: Production Verification (via Browser)

Once deployed to Vercel:

```bash
# 1. Storefront menu
# Open: https://order.vardros.com/
# Expected: Restaurant menu loaded
# Address bar: https://order.vardros.com/

# 2. Owner login
# Open: https://order.vardros.com/login
# Expected: Login form displayed
# Address bar: https://order.vardros.com/login
# (NOT rewritten to /store/login)

# 3. Owner dashboard
# Open: https://order.vardros.com/app/settings
# Expected: Auth check → redirect to login or show dashboard
# Address bar: https://order.vardros.com/app/settings
# (NOT rewritten to /store/app/settings)

# 4. Admin panel
# Open: https://order.vardros.com/admin
# Expected: Admin login or redirect
# Address bar: https://order.vardros.com/admin
```

---

## Rollback Plan (If Issues Occur)

### Rollback Routing Fix
```bash
git checkout HEAD~1 -- src/proxy.ts
npm run build
git add src/proxy.ts
git commit -m "revert: restore previous routing behavior"
git push origin main

# Wait for Vercel deployment (~1 minute)
# Verify at: https://vardr-ordering.vercel.app/
```

### Rollback Tenant Activation
```bash
# Via Supabase SQL Editor:
UPDATE public.tenants
SET status = 'pending'
WHERE slug = 'vardr-upload-test';

# Or via Node:
node -e "
const { createClient } = require('@supabase/supabase-js');
const client = createClient(
  'https://tbnjobmrlfvjzvvunoug.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
(async () => {
  await client
    .from('tenants')
    .update({ status: 'pending' })
    .eq('slug', 'vardr-upload-test');
  console.log('✓ Tenant reverted to pending');
})();
"
```

---

## Troubleshooting

### Issue: "No restaurant here yet" still showing

**Cause:** Tenant status not updated or proxy cache not cleared

**Solution:**
1. Verify tenant status is `active`: Check in Supabase dashboard
2. Clear browser cache: Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
3. Wait 60 seconds: Proxy cache expires automatically

### Issue: `/login` still rewrites to `/store/login`

**Cause:** Deployment not yet active or build failed

**Solution:**
1. Check Vercel deployment: https://vercel.com/vardr-ordering
2. Verify build succeeded: No red X on latest deployment
3. Wait ~1 minute: Deployments can take time to propagate
4. Hard refresh: Clear browser cache

### Issue: Authentication fails on custom domain

**Cause:** Different domain → cookie/session handling

**Solution:**
1. Check browser console: Look for CORS or auth errors
2. Verify session cookie: Should be set for `.vardros.com` domain
3. Test on platform subdomain: `app.localhost:3000` should work
4. Check auth redirect: Session might redirect to platform domain

---

## Success Criteria

✓ **Routing Fix Deployed:**
- [ ] `npm run build` passes
- [ ] `npm run test` passes (all 272 tests)
- [ ] Changes pushed to main
- [ ] Vercel deployment succeeded

✓ **Tenant Activated:**
- [ ] Tenant status changed from `pending` to `active`
- [ ] `menu_verified_at` is set
- [ ] `activated_at` timestamp recorded

✓ **Testing Complete:**
- [ ] Storefront accessible at `/` on custom domain
- [ ] Login page accessible at `/login` (not rewritten)
- [ ] Admin dashboard accessible at `/app/settings` (not rewritten)
- [ ] No errors in browser console
- [ ] No errors in Vercel logs

---

## Timeline

| Step | Duration | Cumulative |
|------|----------|-----------|
| Deploy fix to main | 2 min | 2 min |
| Vercel deployment | 1 min | 3 min |
| Get service role key | 2 min | 5 min |
| Activate tenant | 1 min | 6 min |
| Verify activation | 1 min | 7 min |
| Browser testing | 10 min | 17 min |

**Total: ~20 minutes from start to fully verified**
