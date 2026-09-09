# Demo Builder Deployment Readiness Report

**Date**: 2026-09-09  
**Status**: ✅ CODE READY - INFRASTRUCTURE DECISIONS NEEDED  
**Deployment**: 🛑 BLOCKED - Awaiting infrastructure configuration

---

## Executive Summary

The Restaurant Demo Builder is **production-ready from a code perspective**:
- ✅ All tests passing (24/24 demo-builder tests)
- ✅ Typecheck: 0 errors
- ✅ Build: Success
- ✅ Local testing: Complete and verified

**However, deployment to `https://demo.vardros.com` requires three critical decisions:**

1. **Which Vercel project to use?** (existing or new)
2. **Which Supabase database?** (production, staging, or new)
3. **DNS control**: Who manages `vardros.com` and can add CNAME records?

---

## What's Ready

### Code & Features
- ✅ `/demo-builder` page (public, no auth required)
- ✅ Demo creation API (`POST /api/demo-builder/create`)
- ✅ Sample menu generation (3 categories, ~30 items)
- ✅ Website scraping (optional, non-blocking)
- ✅ Logo upload (optional)
- ✅ Menu upload (optional)
- ✅ Restaurant preview pages
- ✅ "Demo — not yet live" banner
- ✅ Ordering disabled
- ✅ Checkout disabled
- ✅ Payments disabled
- ✅ Delivery disabled
- ✅ Owner claim flow
- ✅ Claim token security (never exposed)

### Test Coverage
```
Test Files:  2 passed (demo-builder tests)
Tests:       24 passed (all demo-builder tests)
Coverage:    Auth bypass, name-only creation, website scraping, 
             duplicate submissions, sample menu, security checks
```

### Documentation
- ✅ `.env.demo.template` - Configuration template
- ✅ `DEMO_DEPLOYMENT_GUIDE.md` - Complete deployment guide
- ✅ Environment variable requirements documented
- ✅ DNS configuration instructions included

---

## What's Needed

### 1. Infrastructure Decision Matrix

| Factor | Option A | Option B |
|--------|----------|----------|
| **Vercel Project** | Use existing `ordering-platform` | Create new `demo` project |
| **Pros** | Simpler, shared infra | Isolated, independent testing |
| **Cons** | Shared with production | Duplicate management |
| **Decision Required** | ✋ YOU CHOOSE |

| Factor | Option 1 | Option 2 |
|--------|----------|----------|
| **Supabase** | Production (`zvvujxngyszyduzsmuco`) | Staging or new (non-prod) |
| **Authorization** | ⚠️ Requires explicit approval | ✅ Recommended (safe testing) |
| **Data Impact** | All demos are production data | Isolated demo environment |
| **Decision Required** | ✋ YOU CHOOSE |

### 2. DNS Records Required

**Two CNAME records needed** (exact target provided by Vercel):

```
CNAME demo.vardros.com → cname-from-vercel.vercel-dns.com
CNAME *.demo.vardros.com → cname-from-vercel.vercel-dns.com
```

**Decision Required:**
- [ ] Who manages `vardros.com` DNS?
- [ ] Can they add CNAME records?
- [ ] Do they have Vercel domain verification access?

### 3. Supabase Credentials

**Need to provide (from chosen Supabase project):**

```
NEXT_PUBLIC_SUPABASE_URL = [https://xxxxx.supabase.co]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [public key]
SUPABASE_SERVICE_ROLE_KEY = [secret key]
```

**Steps to get these:**
1. Open Supabase dashboard
2. Select correct project
3. Settings → API
4. Copy URL and anon key
5. Copy service_role key

---

## Configuration Steps (Ready to Execute)

Once infrastructure decisions are made, these steps can be automated:

### Step 1: Update Environment Variables
```bash
# In Vercel project Settings → Environment Variables
# Add these with values from your Supabase:
NEXT_PUBLIC_ROOT_DOMAIN=demo.vardros.com
NEXT_PUBLIC_SUPABASE_URL=<from Supabase>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase>
ANTHROPIC_API_KEY=<if using Claude scraping>
```

### Step 2: Add Vercel Domains
```bash
# In Vercel project Settings → Domains
# Add these custom domains:
- demo.vardros.com
- *.demo.vardros.com
# (Vercel will provide CNAME targets)
```

### Step 3: Update DNS Records
```bash
# In your DNS provider (guided by Vercel):
# Add CNAME records for demo.vardros.com and *.demo.vardros.com
# pointing to Vercel's CNAME target
```

### Step 4: Deploy
```bash
# Push to main branch (or configured default)
git push origin main
# Vercel auto-deploys
```

### Step 5: Verify
```bash
# Test builder loads
curl https://demo.vardros.com/demo-builder

# Test demo creation
curl -X POST https://demo.vardros.com/api/demo-builder/create \
  -F "name=Test Restaurant"

# Test preview
curl https://<tenant-id>.demo.vardros.com
```

---

## Files Prepared

- ✅ `.env.demo.template` - Configuration template for reference
- ✅ `DEMO_DEPLOYMENT_GUIDE.md` - Step-by-step deployment instructions
- ✅ All code changes committed and tested locally
- ✅ No breaking changes to existing features

---

## Current Infrastructure Context

**Vercel:**
- Project: `ordering-platform`
- Project ID: `prj_QVE7IkBhG0n6nXS8Fr2lgfxM6xGf`
- Team: `connectentinc-2161s-projects`
- Default domain: (to be determined)

**Supabase:**
- Production: `zvvujxngyszyduzsmuco` (⚠️ Do NOT use without authorization)
- Staging: (unknown - to be identified)
- Status: No staging database identified yet

**DNS:**
- Domain: `vardros.com`
- Owner: (to be determined)
- Current records: (unknown)
- Needed: CNAME for `demo` and `*.demo` subdomains

---

## Decision Template

**Fill this in and provide to proceed:**

```markdown
# My Demo Builder Deployment Configuration

## Vercel Project Decision
- [ ] Use existing ordering-platform project
- [ ] Create new ordering-platform-demo project

## Supabase Decision
- [ ] Use production (zvvujxngyszyduzsmuco) - EXPLICIT AUTHORIZATION GIVEN
- [ ] Use staging Supabase: [name/URL]
- [ ] Create new Supabase project for demos

## DNS Control
- DNS provider: [example: Route53, Cloudflare, GoDaddy]
- Who manages it: [name/team]
- Can add CNAME records: [yes/no]
- Contact for DNS changes: [email/name]

## Supabase Credentials (once decided)
- NEXT_PUBLIC_SUPABASE_URL: [paste here]
- NEXT_PUBLIC_SUPABASE_ANON_KEY: [paste here]
- SUPABASE_SERVICE_ROLE_KEY: [paste here]

## Vercel Domain Targets (from Vercel console)
- CNAME target for demo.vardros.com: [paste here]
- CNAME target for *.demo.vardros.com: [paste here]

## Deployment Authorization
- Authorized to deploy to [environment]
- Timeline: [when should this go live?]
- Rollback plan: [if needed?]
```

---

## What NOT To Do (Yet)

🛑 **DO NOT:**
- Deploy without filling in the decision template above
- Use production Supabase without explicit authorization
- Configure DNS records without knowing the exact Vercel CNAME targets
- Create a Vercel project without team consensus

---

## Next Steps

1. **Provide configuration decisions** (use template above)
2. **Confirm database choice** (including authorization if production)
3. **Provide DNS access** (or coordinates for DNS team)
4. **Provide Supabase credentials** (from chosen environment)
5. I will configure Vercel environment variables
6. I will document exact DNS records needed
7. You add DNS records
8. Deploy to Vercel
9. Verify all flows working

**Timeline**: Ready to execute within 30 minutes of receiving decisions + credentials.

---

## Risk Assessment

**If using production Supabase:**
- ⚠️ All demo activity appears in production database
- ⚠️ Demo tenants mixed with real customers
- ⚠️ No rollback isolation

**If using staging Supabase:**
- ✅ Safe to test and iterate
- ✅ Isolated from customer data
- ✅ Can reset if needed

**Recommendation**: Use staging or new Supabase for safety during rollout.

---

## Questions & Clarifications

**Waiting on your input:**
- [ ] Vercel project choice?
- [ ] Supabase environment choice?
- [ ] DNS provider and contact?
- [ ] Timeline for go-live?
- [ ] Rollback/fallback plan?

Provide these and deployment can proceed immediately.
