import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const PROXY = readFileSync('src/proxy.ts', 'utf8');
const PAGE = readFileSync('src/app/(storefront)/store/page.tsx', 'utf8');
const CHECKOUT = readFileSync('src/app/(storefront)/store/checkout/page.tsx', 'utf8');
const BANNER = readFileSync('src/components/storefront/preview-banner.tsx', 'utf8');
const PREVIEW = readFileSync('src/lib/storefront/preview.ts', 'utf8');

afterEach(() => { delete process.env.NEXT_PUBLIC_CLAIM_CTA_URL; vi.resetModules(); });

describe('public preview access', () => {
  it('pending_claim renders the storefront instead of the unavailable page', () => {
    expect(PROXY).toMatch(/const isPreview = tenant\.status === 'pending_claim';/);
    expect(PROXY).toMatch(/if \(!isPreview && tenant\.status !== 'active'\)/);
  });

  it('every other non-active status stays hidden', () => {
    // 'suspended' and 'cancelled' are storefronts that must go dark. Only the
    // unclaimed one is a demo.
    expect(PROXY).toMatch(/storefront-unavailable\/\$\{tenant\.status\}/);
    expect(PROXY).not.toMatch(/status === 'suspended'[\s\S]{0,80}rewrite\(request, `\/store/);
  });

  it('the status union comes from the enum, not a hand-copied list', () => {
    // The literal union here never learned about 'pending_claim', which is how
    // every staged storefront fell silently into "not claimed yet".
    expect(PROXY).toMatch(/status: TenantStatus;/);
    expect(PROXY).not.toMatch(/status: 'pending' \| 'active' \| 'suspended' \| 'cancelled';/);
  });

  it('the preview header cannot be forged from outside', () => {
    // It is stripped with the other tenancy headers before being set.
    expect(PROXY).toMatch(/TENANT_PREVIEW_HEADER,\n\s*IMPERSONATION_HEADER,/);
    expect(PROXY).toMatch(/for \(const header of SPOOFABLE_HEADERS\) requestHeaders\.delete\(header\);/);
  });

  it('viewing does not activate the tenant', () => {
    // Nothing in the storefront branch writes a status.
    expect(PROXY).not.toMatch(/status:\s*'active'/);
    expect(PROXY).not.toMatch(/\.update\(|claim_tenant/);
  });
});

describe('ordering is refused while unclaimed', () => {
  it('the menu renders with ordering forced off', () => {
    expect(PAGE).toMatch(/canOrder=\{canOrder && !preview\}/);
  });

  it('checkout redirects away even if the URL is typed directly', () => {
    expect(CHECKOUT).toMatch(/if \(!canOrder \|\| \(await isPreviewRequest\(\)\)\) redirect\('\/'\);/);
  });

  it('the database refuses independently of the UI', () => {
    // price_cart rejects a non-active tenant, and every scraped item is
    // unavailable until the owner confirms. The UI is the third layer, not
    // the only one.
    const checkout = readFileSync('supabase/migrations/20260902090600_checkout.sql', 'utf8');
    expect(checkout).toMatch(/v_tenant\.status <> 'active'/);
    expect(checkout).toMatch(/if not v_item\.is_available then/);
  });
});

describe('what the preview shows and hides', () => {
  it('states plainly that it is a preview and takes no orders', () => {
    expect(BANNER).toMatch(/Preview — not yet live/);
    expect(BANNER).toMatch(/This storefront was prepared for your restaurant/);
    expect(BANNER).toMatch(/Nothing here can take an order or a payment yet/);
    expect(BANNER).toMatch(/Activate My Storefront/);
  });

  it('never renders a claim token, tenant id, or internal field', () => {
    for (const forbidden of [/claim_token/i, /tenantId/, /tenant_id/, /token=/, /service_role/i, /stripe/i]) {
      expect(BANNER).not.toMatch(forbidden);
    }
  });

  it('the CTA points at the sales route, never at a claim link', () => {
    // A claim link grants ownership to whoever opens it. On a public page that
    // is the whole storefront handed to the first stranger who looks.
    expect(PREVIEW).not.toMatch(/claim_token|token=/);
    expect(PREVIEW).toMatch(/NEXT_PUBLIC_CLAIM_CTA_URL/);
  });

  it('the CTA is configurable and defaults to the claim route', async () => {
    const { claimCtaHref } = await import('./preview');
    expect(claimCtaHref()).toBe('/claim');
    process.env.NEXT_PUBLIC_CLAIM_CTA_URL = 'https://sales.example/get-started';
    vi.resetModules();
    const again = await import('./preview');
    expect(again.claimCtaHref()).toBe('https://sales.example/get-started');
  });
});

describe('admin surfaces stay locked', () => {
  it('the preview change touches only the storefront branch', () => {
    // The app and admin surfaces resolve by hostname and are unaffected: their
    // gate is a session, not a tenant status.
    const appBranch = PROXY.slice(PROXY.indexOf("case 'admin':"), PROXY.indexOf("case 'storefront':"));
    expect(appBranch).not.toMatch(/isPreview|TENANT_PREVIEW_HEADER/);
    expect(appBranch).toMatch(/if \(!user && !pathname\.startsWith\('\/login'\)\)/);
  });
});

describe('a signed-in visitor without access', () => {
  it('is told what is wrong, not that the page does not exist', () => {
    // The first real claim ended here: the browser still held a super_admin
    // session, resolveStaffTenantId() returns null for a super admin outside
    // impersonation, and the new owner was shown "Page not found".
    const layout = readFileSync('src/app/(kds)/app/(dashboard)/layout.tsx', 'utf8');
    expect(layout).toMatch(/return <WrongAccountNotice \/>;/);
    expect(layout).not.toMatch(/if \(!staff\) notFound\(\);/);

    const notice = readFileSync('src/components/dashboard/wrong-account-notice.tsx', 'utf8');
    expect(notice).toMatch(/not with an account that has access here/i);
    expect(notice).toMatch(/admin console/i);
    // It renders for a visitor with no claim to this tenant, so it must not
    // confirm which restaurant lives at this address.
    for (const leak of [/tenantId/, /tenant\.name/, /claim_token/, /slug/]) {
      expect(notice).not.toMatch(leak);
    }
  });
});

describe('a preview looks like a demo, not an outage', () => {
  const BROWSER = readFileSync('src/components/storefront/menu-browser.tsx', 'utf8');
  const HEADER = readFileSync('src/components/storefront/storefront-header.tsx', 'utf8');

  it('never labels an item Sold out merely because preview ordering is off', () => {
    // Every scraped item is unavailable until the owner confirms the menu, but
    // that is a fact about our staging process. Showing "Sold out" across a
    // demo tells a prospect their own business is closed.
    expect(BROWSER).toMatch(/const soldOut = !preview && !item\.is_available;/);
    expect(BROWSER).toMatch(/const disabled = !preview && \(soldOut \|\| !canOrder\);/);
  });

  it('explains the disabled ordering when a card is pressed', () => {
    const fn = BROWSER.slice(BROWSER.indexOf('function openItem'), BROWSER.indexOf('const hasGroups'));
    // Checked FIRST: an unclaimed storefront also has canOrder false, and
    // "this restaurant is not accepting orders" reads as the kitchen being shut.
    expect(fn.indexOf('if (preview)')).toBeLessThan(fn.indexOf('if (!canOrder)'));
    expect(fn).toMatch(/Ordering is disabled during this preview\. Activate your storefront to accept orders\./);
  });

  it('shows both calls to action with the agreed wording', () => {
    const banner = readFileSync('src/components/storefront/preview-banner.tsx', 'utf8');
    expect(banner).toMatch(/Preview — not yet live/);
    expect(banner).toMatch(/This storefront was prepared for your restaurant\. Explore the menu and see how online\s*\n?\s*ordering could look\./);
    expect(banner).toMatch(/Activate My Storefront/);
    expect(banner).toMatch(/Book a Walkthrough/);
  });

  it('falls back to branded artwork rather than a blank hero or a single letter', () => {
    // The stock cover darkened to 50% read as a blank brown rectangle, and a
    // one-letter avatar reads as a missing asset.
    expect(HEADER).toMatch(/function monogram\(name: string\)/);
    expect(HEADER).not.toMatch(/FALLBACK_COVER/);
    expect(HEADER).toMatch(/linear-gradient\(135deg, var\(--brand-primary\) 0%, var\(--brand-accent\) 100%\)/);
    // The restaurant's name carries the hero when there is no photograph.
    expect(HEADER).toMatch(/\{tenantName\}\s*\n\s*<\/p>/);
  });

  it('gives an item with no photograph a tinted tile, not a grey square', () => {
    expect(BROWSER).not.toMatch(/className="h-24 w-24 flex-shrink-0 rounded-lg bg-neutral-100"/);
    expect(BROWSER).toMatch(/color-mix\(in srgb, var\(--brand-primary\)/);
  });
});
