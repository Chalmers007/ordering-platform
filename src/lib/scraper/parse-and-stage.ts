/**
 * Scraped page → validated menu → a claim-gated staging tenant.
 *
 * ── What this refuses to do ──────────────────────────────────────────────────
 * It never produces a live storefront. The tenant it creates sits at
 * 'pending_claim' (invisible to anon by RLS) and every menu item it writes is
 * marked `source = 'scraped'`, which the database trigger forces unavailable
 * while `tenants.menu_verified_at` is null. price_cart() refuses an
 * unavailable item, so nothing here can be ordered until a human confirms the
 * menu is right.
 *
 * That is deliberate and worth stating plainly: this pipeline assembles claims
 * about somebody else's business — their dishes, their prices, their brand —
 * from data they never gave us. Some of it will be wrong or stale on the day
 * it is read. Publishing it as a working storefront would take a diner's money
 * at a price the restaurant never set.
 *
 * Two independent gates, and neither implies the other:
 *   claiming    → proves who owns the storefront
 *   confirming  → proves the menu is accurate
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { createMenuParser, parseStructured, type MenuParseProvider, type ParseRequest } from './provider';
import { itemCount, parsedRestaurantSchema, slugify, type ParsedRestaurant } from './schema';

export interface StageInput {
  content: string;
  sourceUrl: string;
  nameHint?: string | null;
  /** Overridden in tests. */
  provider?: MenuParseProvider;
  /** Days the claim link stays redeemable. */
  claimTtlDays?: number;
}

export interface StageResult {
  tenantId: string;
  slug: string;
  name: string;
  claimToken: string;
  categories: number;
  items: number;
  /** Which parser produced the menu: 'structured' or the provider's name. */
  parsedBy: string;
  /** Lines the page showed that could not be staged, with the reason. */
  skipped: string[];
}

export type StagingFailure = 'unparseable' | 'no_menu' | 'invalid' | 'db';

export class StagingError extends Error {
  // A plain field, not a parameter property: this repo runs scripts with bare
  // `node --env-file`, whose strip-only TypeScript mode rejects those.
  readonly reason: StagingFailure;

  constructor(message: string, reason: StagingFailure) {
    super(message);
    this.name = 'StagingError';
    this.reason = reason;
  }
}

function serviceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StagingError('Supabase service credentials are not set', 'db');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/**
 * Parse only. Exposed so a caller can review what would be staged before any
 * row is written — the dry run that a scraped menu deserves.
 */
export async function parseRestaurant(input: StageInput): Promise<{ parsed: ParsedRestaurant; parsedBy: string; skipped: string[] }> {
  const req: ParseRequest = { content: input.content, sourceUrl: input.sourceUrl, nameHint: input.nameHint ?? null };

  // Structured markup first: it is exact, free, and most modern restaurant
  // sites publish it. The model is the fallback, not the default.
  let raw = parseStructured(req);
  let parsedBy = 'structured';
  if (!raw) {
    const provider = input.provider ?? createMenuParser();
    raw = await provider.parse(req);
    parsedBy = provider.name;
  }

  const withSource = { ...raw, sourceUrl: input.sourceUrl };
  const result = parsedRestaurantSchema.safeParse(withSource);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    // An empty menu is a different outcome from a malformed one: the page may
    // simply not have been a menu, which is not an error to retry.
    const empty = Array.isArray((raw as { categories?: unknown[] }).categories) && (raw as { categories: unknown[] }).categories.length === 0;
    throw new StagingError(
      empty ? 'the page contained no menu' : `parsed menu failed validation — ${issues.join('; ')}`,
      empty ? 'no_menu' : 'invalid',
    );
  }

  const parsed = result.data;
  const skipped: string[] = [];
  if (!parsed.name) throw new StagingError('the page contained no business name', 'no_menu');

  return { parsed, parsedBy, skipped };
}

/**
 * Stage a parsed restaurant: provision a tenant, write the menu, issue a claim
 * token. Idempotent on slug — re-staging the same restaurant updates its menu
 * rather than creating a second storefront.
 */
export async function parseAndStage(input: StageInput): Promise<StageResult> {
  const { parsed, parsedBy, skipped } = await parseRestaurant(input);
  const db = serviceClient();

  const { data: tenant, error: provisionError } = await db.rpc('provision_tenant', {
    p_name: parsed.name,
    p_slug: slugify(parsed.name),
  });
  if (provisionError || !tenant) {
    throw new StagingError(`could not provision a tenant: ${provisionError?.message ?? 'no row returned'}`, 'db');
  }
  const row = (Array.isArray(tenant) ? tenant[0] : tenant) as { id: string; slug: string; name: string };

  await applyBranding(db, row.id, parsed);
  const written = await writeMenu(db, row.id, parsed);

  const { data: token, error: tokenError } = await db.rpc('issue_claim_token', {
    p_tenant_id: row.id,
    p_ttl_days: input.claimTtlDays ?? 14,
  });
  if (tokenError || !token) {
    throw new StagingError(`could not issue a claim token: ${tokenError?.message ?? 'no token returned'}`, 'db');
  }

  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    claimToken: String(token),
    categories: parsed.categories.length,
    items: written,
    parsedBy,
    skipped,
  };
}

async function applyBranding(db: SupabaseClient<Database>, tenantId: string, parsed: ParsedRestaurant): Promise<void> {
  const b = parsed.branding;
  const patch: Record<string, unknown> = {};
  if (b.primaryColor) patch.brand_primary_color = b.primaryColor;
  if (b.accentColor) patch.brand_accent_color = b.accentColor;
  // Only colours are applied. A logo or hero read off a page is somebody's
  // copyrighted artwork on an origin we do not control — the URLs are carried
  // through on the result for a human to approve, never hot-linked into a
  // storefront by this function.
  if (Object.keys(patch).length === 0) return;
  await db.from('tenant_settings').update(patch as never).eq('tenant_id', tenantId);
}

async function writeMenu(db: SupabaseClient<Database>, tenantId: string, parsed: ParsedRestaurant): Promise<number> {
  let items = 0;
  for (const [index, category] of parsed.categories.entries()) {
    const { data: cat, error: catError } = await db
      .from('menu_categories')
      .upsert(
        {
          tenant_id: tenantId,
          name: category.name,
          slug: slugify(category.name),
          description: category.description,
          sort_order: index,
        } as never,
        { onConflict: 'tenant_id,slug' },
      )
      .select('id')
      .single();
    if (catError || !cat) throw new StagingError(`category "${category.name}": ${catError?.message}`, 'db');

    for (const [i, item] of category.items.entries()) {
      const { error: itemError } = await db.from('menu_items').upsert(
        {
          tenant_id: tenantId,
          category_id: (cat as { id: string }).id,
          name: item.name,
          slug: slugify(item.name),
          description: item.description,
          price_cents: item.priceCents,
          calories: item.calories,
          sort_order: i,
          // The trigger forces is_available false while the menu is
          // unverified. Setting it here too would be a second place to get it
          // wrong, so the database owns that decision.
          source: 'scraped',
          source_url: parsed.sourceUrl,
        } as never,
        { onConflict: 'tenant_id,slug' },
      );
      if (itemError) throw new StagingError(`item "${item.name}": ${itemError.message}`, 'db');
      items += 1;
    }
  }
  return items;
}

export { itemCount };
