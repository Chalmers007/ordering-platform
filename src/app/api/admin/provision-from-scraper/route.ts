import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireBridgeCaller } from '@/lib/admin/bridge-auth';
import { drainWebhookEvents } from '@/lib/webhooks/dispatch';
import { parseAndStage, parseRestaurant, StagingError } from '@/lib/scraper/parse-and-stage';
import { itemCount } from '@/lib/scraper/schema';

/**
 * The bridge: a scraped page in, a claim link out.
 *
 * vardr-os (or any scraper) posts the raw page it fetched. This parses it,
 * provisions a STAGING tenant, writes the menu as unverified, issues a claim
 * token, and returns the link the outreach sequence sends to the restaurant.
 *
 * ── What comes back is not a live storefront ─────────────────────────────────
 * The tenant sits at 'pending_claim', which the tenants_select policy hides
 * from anon entirely, and every item is `source = 'scraped'` and therefore
 * unavailable until someone confirms the menu. So the claim link is the ONLY
 * way in, and even after claiming, nothing can be ordered until the owner
 * says the prices are right. See lib/scraper/parse-and-stage.ts.
 *
 * `?dryRun=1` parses and returns what WOULD be staged without writing a row —
 * which is how a scraped menu should be looked at the first time.
 *
 * Reachable two ways, and no others: a super-admin session (the dashboard), or
 * a shared bridge secret (vardr-os, which has no cookie). This creates tenants
 * and mints ownership tokens, so the secret is worth an admin password — see
 * lib/admin/bridge-auth.ts for how it is compared and why an unset secret
 * disables the machine path rather than opening it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_CHARS = 500_000;

const payloadSchema = z.object({
  /** Raw HTML or extracted text of the page that was scraped. */
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
  sourceUrl: z.string().url().max(2048),
  /** What the scraper thinks the business is called. Advisory only. */
  nameHint: z.string().max(160).nullish(),
  claimTtlDays: z.number().int().min(1).max(90).optional(),
});

function claimOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('host') ?? '';
  return `${proto}://${host.replace(/^admin\./, '')}`;
}

function statusForStagingError(reason: StagingError['reason']): number {
  switch (reason) {
    // The page was fetched fine and simply is not a menu. That is a fact about
    // the input, not a server fault, and a caller must not retry it.
    case 'no_menu':
      return 422;
    case 'unparseable':
    case 'invalid':
      return 422;
    // The request was well-formed and the menu was fine; the name is taken.
    case 'conflict':
      return 409;
    case 'db':
      return 500;
  }
}

export async function POST(request: NextRequest) {
  const caller = await requireBridgeCaller(request);
  if (!caller.ok) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  try {
    if (dryRun) {
      const { parsed, parsedBy } = await parseRestaurant({
        content: body.content,
        sourceUrl: body.sourceUrl,
        nameHint: body.nameHint ?? null,
      });
      return NextResponse.json({
        dryRun: true,
        parsedBy,
        name: parsed.name,
        cuisine: parsed.cuisine,
        branding: parsed.branding,
        categories: parsed.categories.map((c) => ({ name: c.name, items: c.items.length })),
        items: itemCount(parsed),
        // Nothing was written, so there is nothing to claim.
        preview: parsed.categories.flatMap((c) => c.items.slice(0, 3).map((i) => ({ category: c.name, name: i.name, priceCents: i.priceCents }))).slice(0, 15),
      });
    }

    const staged = await parseAndStage({
      content: body.content,
      sourceUrl: body.sourceUrl,
      nameHint: body.nameHint ?? null,
      claimTtlDays: body.claimTtlDays,
    });

    // provision_tenant() already queued tenant.provisioned. Draining here means
    // the CRM learns about the storefront in the same request that made it,
    // rather than on whenever the next drain happens to run.
    let webhook: { delivered: number; failed: number; skipped: number } | { error: string };
    try {
      webhook = await drainWebhookEvents(staged.tenantId);
    } catch (error) {
      // A CRM that is down must not lose us the tenant we just built. The row
      // stays in the outbox for the next drain.
      webhook = { error: error instanceof Error ? error.message : 'drain failed' };
    }

    const origin = claimOrigin(request);
    return NextResponse.json(
      {
        tenantId: staged.tenantId,
        slug: staged.slug,
        name: staged.name,
        parsedBy: staged.parsedBy,
        categories: staged.categories,
        items: staged.items,
        // The link the restaurant is sent. It is a bearer credential granting
        // ownership: single-use, expiring, and the only route to the storefront
        // while the tenant is unclaimed.
        claimUrl: `${origin}/claim?token=${staged.claimToken}`,
        menuVerified: false,
        note: 'Storefront is claim-gated and the menu is unverified. No item can be ordered until the owner confirms it.',
        webhook,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof StagingError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: statusForStagingError(error.reason) });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Staging failed' }, { status: 500 });
  }
}
