# Custom Domain Routing Fix

## Problem

The domain `order.vardros.com` (and other custom domains) was rewriting ALL path requests to the storefront surface (`/store/*`), blocking access to administrative and dashboard routes (`/login`, `/app`, `/admin`). This prevented staff from accessing the owner dashboard even on the restaurant's own domain.

## Root Cause

In `src/proxy.ts`, the storefront surface routing logic unconditionally rewrites all paths to `/store/*`:

```typescript
// Before: ALL paths rewritten to /store/*
return applyCookies(rewrite(request, `/store${pathname === '/' ? '' : pathname}`, requestHeaders));
```

This prevented staff routes from being accessible on custom domains, even though they should be available to restaurant owners on their own domains.

## Solution

Modified `src/proxy.ts` (lines 305-315) to explicitly allow staff paths (`/app`, `/login`, `/admin`) on custom domains without rewriting them:

```typescript
// On custom domains, allow staff to access /app, /login, and /admin paths
// without rewriting them to /store. This enables owner dashboards on
// restaurant-owned domains while keeping the storefront accessible at /.
const isStaffPath = pathname.startsWith('/app') || pathname.startsWith('/login') || pathname.startsWith('/admin');
if (isStaffPath) {
  // Pass through to the handler without rewriting. Staff auth checks
  // (role, tenant membership) happen server-side in the layout.
  return applyCookies(NextResponse.next({ request: { headers: requestHeaders } }));
}

// A tenant reached by custom domain never sees its platform subdomain:
// the rewrite is internal, so the address bar keeps the tenant's own
// hostname. That is the whole point of white labelling.
return applyCookies(rewrite(request, `/store${pathname === '/' ? '' : pathname}`, requestHeaders));
```

## Behavior After Fix

| Domain | Path | Behavior |
|--------|------|----------|
| `order.vardros.com` | `/` | Storefront home (rewritten to `/store`) ✅ |
| `order.vardros.com` | `/menu` | Menu page (rewritten to `/store/menu`) ✅ |
| `order.vardros.com` | `/orders/{token}` | Customer tracking (rewritten to `/store/orders/{token}`) ✅ |
| `order.vardros.com` | `/login` | Staff login (NOT rewritten, passes through) ✅ |
| `order.vardros.com` | `/app/settings` | Owner dashboard (NOT rewritten, passes through) ✅ |
| `order.vardros.com` | `/admin` | Admin panel (NOT rewritten, passes through) ✅ |

## Security

- Staff route access is still gated by server-side authentication in the layout
- The tenant context headers are still set and passed to all requests
- No credentials are exposed in the routing logic
- Authorization checks (role, tenant membership) happen in the handler, not the proxy

## Activation of Test Tenant

### Option 1: Run Activation RPC (Recommended)

Set your Supabase service role key and run:

```bash
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
node /tmp/activate-tenant.js vardr-upload-test
```

This script will:
1. Find the `vardr-upload-test` tenant
2. Check if menu is verified (mark as verified if needed)
3. Call the `activate_storefront` RPC
4. Return the new status

### Option 2: Run SQL Migration

Deploy the migration to mark the test tenant as verified and active:

```bash
npx supabase migration up 20260904000100_activate_test_tenant
```

Or run manually via Supabase dashboard:

```sql
-- Mark menu as verified
UPDATE public.tenants
SET menu_verified_at = now()
WHERE slug = 'vardr-upload-test';

-- Activate the storefront
SELECT public.activate_storefront(id)
FROM public.tenants
WHERE slug = 'vardr-upload-test';

-- Verify status changed
SELECT id, slug, status, menu_verified_at
FROM public.tenants
WHERE slug = 'vardr-upload-test';
```

### Option 3: Update Status Directly (Emergency Only)

If activation RPC is blocked by prerequisites, update the status directly:

```sql
UPDATE public.tenants
SET status = 'active', activated_at = now()
WHERE slug = 'vardr-upload-test';
```

## Testing the Fix

### Local Development

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Add domain to `/etc/hosts` (macOS/Linux):**
   ```bash
   echo "127.0.0.1 order.localhost" | sudo tee -a /etc/hosts
   ```

3. **Test paths:**
   ```bash
   # Storefront
   curl -H "Host: order.localhost" http://localhost:3000/
   curl -H "Host: order.localhost" http://localhost:3000/menu
   
   # Staff routes (no rewrite)
   curl -H "Host: order.localhost" http://localhost:3000/login
   curl -H "Host: order.localhost" http://localhost:3000/app/settings
   ```

4. **Verify via browser:**
   - `http://order.localhost:3000/` → Storefront menu
   - `http://order.localhost:3000/login` → Login page (not rewritten)
   - `http://order.localhost:3000/app/settings` → Settings (requires auth)

### Production (Vercel)

1. **Deploy the proxy.ts fix:**
   ```bash
   git add src/proxy.ts
   git commit -m "fix: allow staff routes on custom domains"
   git push
   # Vercel auto-deploys on push
   ```

2. **Activate the tenant via Supabase dashboard:**
   - Go to SQL Editor
   - Run the activation SQL (see Option 2 above)

3. **Test in browser:**
   - `https://order.vardros.com/` → Storefront (rewritten to `/store`)
   - `https://order.vardros.com/login` → Login page (NOT rewritten)
   - `https://order.vardros.com/app/settings` → Settings dashboard

## Changes Made

| File | Change |
|------|--------|
| `src/proxy.ts` | Added staff path check to exclude `/app`, `/login`, `/admin` from storefront rewrite |
| `supabase/migrations/20260904000100_activate_test_tenant.sql` | Migration to activate test tenant |

## Verification Checklist

- [x] Build passes (`npm run build`)
- [x] Tests pass (`npm run test`)
- [x] TypeScript errors: 0
- [x] ESLint errors: 0
- [ ] Tenant activated (pending execution)
- [ ] Staff can access `/login` on custom domain
- [ ] Staff can access `/app/settings` on custom domain
- [ ] Storefront still accessible at `/` on custom domain
- [ ] API routes work correctly (`/api/*`)

## Rollback

If needed, revert the proxy.ts change:

```bash
git checkout HEAD -- src/proxy.ts
npm run build
git push
```

This reverts to the previous behavior where all custom domain paths are rewritten to `/store/*`.

## Related Issues

- Tenant status `pending` → `active` transition blocked customer access
- No pre-activation prerequisites enforcement
- Staff dashboard unreachable on custom domains

## Future Improvements

1. Add a `/super` path for staff to access multi-tenant admin without a tenant context
2. Implement menu verification workflow to remove manual `menu_verified_at` updates
3. Add tenant onboarding checklist to guide staff through activation prerequisites
