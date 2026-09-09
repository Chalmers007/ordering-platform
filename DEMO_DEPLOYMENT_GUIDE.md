# Restaurant Demo Builder Deployment Guide

This guide covers deploying the Restaurant Demo Builder to `https://demo.vardros.com` with restaurant previews at `https://<tenant-id>.demo.vardros.com`.

## Pre-Deployment Checklist

**STOP: Do NOT proceed with deployment until you have:**

- [ ] Decided which **Vercel project** to use
- [ ] Identified which **Supabase database** (prod/staging/new)
- [ ] Confirmed **DNS control** for `vardros.com`
- [ ] Identified who can update Vercel domain settings

---

## Option A: Use Existing `ordering-platform` Vercel Project

**Pros:**
- Single project for all ordering features
- Shared infrastructure (Raven provisioning, payments, etc.)
- Simpler management

**Cons:**
- Demo and production share same domain infrastructure
- Require coordination with existing deployments

**If choosing this:**
1. Confirm with team that this is correct approach
2. Proceed to "Option 1: Production Supabase" or "Option 2: Separate Staging Supabase"

---

## Option B: Create Separate `ordering-platform-demo` Vercel Project

**Pros:**
- Isolated from production ordering
- Can test independently
- Separate staging environment

**Cons:**
- Requires new Vercel project setup
- Separate infrastructure management
- Duplicate codebase configuration

**If choosing this:**
1. Create new Vercel project in connectentinc-2161s-projects team
2. Connect to same GitHub repo
3. Proceed to "Option 1: Production Supabase" or "Option 2: Separate Staging Supabase"

---

## Option 1: Production Supabase (zvvujxngyszyduzsmuco)

**⚠️ REQUIRES EXPLICIT AUTHORIZATION**

**Pros:**
- Single database for all customers and demos
- Simpler architecture

**Cons:**
- Demo activity affects production database
- Can't test destructively
- All demos are production data

**If choosing this:**
1. Confirm authorization is explicitly given
2. Get production Supabase credentials:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
3. Proceed to "Vercel Configuration" section

---

## Option 2: Separate Staging Supabase

**Recommended for safe testing**

**Pros:**
- Isolated demo data
- Can test without affecting production
- Safe for experimentation
- Matches your earlier guidance: "non-production database"

**Cons:**
- Requires managing separate Supabase project
- Staging data is separate from production

**If choosing this:**
1. Identify existing staging Supabase project, OR
2. Create new Supabase project for demos, OR
3. Create new Supabase project specifically for demo builder
4. Get staging Supabase credentials:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
5. Proceed to "Vercel Configuration" section

---

## DNS Records Required

Regardless of Vercel project or Supabase choice, you need **DNS records**:

### For `demo.vardros.com`:

**Via Vercel (recommended):**
1. In Vercel project → Settings → Domains
2. Add `demo.vardros.com`
3. Vercel will provide CNAME target (e.g., `cname.vercel-dns.com`)
4. Add CNAME record in your DNS provider:
   ```
   Name: demo
   Type: CNAME
   Value: cname.vercel-dns.com
   ```

### For `*.demo.vardros.com` (wildcard):

**Via Vercel:**
1. In Vercel project → Settings → Domains
2. Add `*.demo.vardros.com`
3. Vercel will provide CNAME target
4. Add wildcard CNAME in your DNS provider:
   ```
   Name: *.demo
   Type: CNAME
   Value: cname.vercel-dns.com
   ```

**Alternative (if using root domain `vardros.com`):**
```
Name: demo
Type: A or AAAA
Value: Vercel IP address (provided by Vercel)
```

---

## Vercel Configuration Steps

Once you've decided on project and database:

### 1. Environment Variables (Vercel Dashboard)

**Steps:**
1. Go to Vercel → Select project (ordering-platform or new demo project)
2. Settings → Environment Variables
3. Add the following (fill with your values):

```
NEXT_PUBLIC_ROOT_DOMAIN = demo.vardros.com
NEXT_PUBLIC_SUPABASE_URL = [your Supabase URL]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [your anon key]
SUPABASE_SERVICE_ROLE_KEY = [your service role key]
ANTHROPIC_API_KEY = [your API key if using Claude for scraping]
CRON_SECRET = [random secret string]
```

**Scope settings:**
- Production deployment: NEXT_PUBLIC_* for all environments, secrets for production only
- Preview deployments: Same variables for testing

### 2. Add Custom Domains (Vercel Dashboard)

**Steps:**
1. Vercel project → Settings → Domains
2. Click "Add Domain"
3. Add `demo.vardros.com`
   - Type: Domain
   - Vercel will show DNS records needed
4. Click "Add Domain" again
5. Add `*.demo.vardros.com`
   - Type: Wildcard Domain
   - Vercel will show DNS records needed

### 3. Deploy

**Steps:**
1. Merge/commit code to `main` branch (or your default branch)
2. Vercel will auto-deploy to production
3. Verify builds complete successfully

### 4. Verify DNS Configuration

**Steps:**
1. Add CNAME records to your DNS provider (as shown by Vercel)
2. Wait for DNS propagation (up to 48 hours, usually <5 min)
3. Verify: `nslookup demo.vardros.com` should resolve to Vercel IP

---

## Post-Deployment Verification

Once deployed, test the complete flow:

### 1. Test Builder Access
```bash
curl -I https://demo.vardros.com/demo-builder
# Should return: HTTP/1.1 200 OK (no redirect to login)
```

### 2. Test Demo Creation
```bash
curl -X POST https://demo.vardros.com/api/demo-builder/create \
  -F "name=Test Restaurant"
# Should return: 201 Created with tenant_id and preview_url
```

### 3. Test Preview Access
```bash
# Using the tenant_id from above:
curl -I https://<tenant-id>.demo.vardros.com
# Should return: HTTP/1.1 200 OK
# Page should show "Demo — not yet live" banner
```

### 4. Test Security
```bash
# Verify no claim tokens in responses:
curl https://demo.vardros.com/api/demo-builder/create \
  -F "name=Test" | grep -i "claim_token"
# Should return: (empty - no claim tokens exposed)
```

### 5. Test Features
- [ ] Name-only demo creation works
- [ ] Website upload (optional, doesn't block demo)
- [ ] Logo upload (optional)
- [ ] Menu upload (optional)
- [ ] Duplicate restaurant name reuses existing demo
- [ ] Preview shows sample menu with items
- [ ] Ordering disabled
- [ ] Checkout disabled
- [ ] Payments disabled
- [ ] Delivery disabled
- [ ] Owner can view claim link in preview
- [ ] Owner can claim and verify menu to enable ordering

---

## Troubleshooting

### Domain returns 404
- DNS records not propagated yet (wait a few minutes)
- DNS records pointing to wrong Vercel project
- Domain not added to Vercel project settings

### Demo creation fails
- Check Supabase credentials in environment variables
- Verify Supabase database is accessible from Vercel
- Check server logs in Vercel dashboard

### Preview is blank
- Check browser console for errors
- Verify tenant was created in database
- Check Supabase database for demo_fallback_state record

### Ordering appears enabled
- Verify menu_verified_at is NULL (not verified)
- Check database for menu items marked source='sample'
- Sample items should be unavailable

---

## Current State Summary

**Code:** ✅ Ready to deploy (all tests passing)

**Infrastructure:**
- Vercel project: `ordering-platform` (prj_QVE7IkBhG0n6nXS8Fr2lgfxM6xGf)
- Status: NOT YET CONFIGURED (requires decisions below)

**Decisions needed:**
1. ❓ Vercel project: Use existing or create new?
2. ❓ Supabase: Production (zvvujxngyszyduzsmuco), staging, or new?
3. ❓ DNS: Who manages `vardros.com`? Can you add CNAME records?

**Next steps:**
1. Make decisions above
2. Gather credentials from chosen Supabase project
3. Configure Vercel environment variables
4. Add DNS records
5. Deploy
6. Run verification tests

---

## Contact & Support

If you need to:
- Create a new Vercel project
- Create a new Supabase project
- Understand DNS configuration
- Debug deployment issues

Provide those details and I can help configure and deploy.

**DO NOT PROCEED** with deployment until all three decisions above are made.
