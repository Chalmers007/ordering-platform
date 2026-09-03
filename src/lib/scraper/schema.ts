/**
 * The shape a scraped restaurant must reduce to before it touches the database.
 *
 * PURE. No I/O, no provider, no Supabase.
 *
 * ── Why a schema and not a prompt ────────────────────────────────────────────
 * The parser's input is an arbitrary web page and its output becomes prices in
 * a storefront. An LLM asked for "the menu as JSON" will cheerfully return
 * `"$12.99"`, `"12.99"`, `1299`, `"market price"` and `null` for the same
 * field across four restaurants, and a plausible-looking number is the failure
 * that survives review. So the boundary is a schema that refuses anything it
 * cannot store, and every rejection is a named reason rather than a coerced
 * value.
 *
 * Prices are integer CENTS. Never a float: 12.99 * 100 is 1298.9999999999998,
 * and a menu that is a cent light on every item is the kind of bug nobody
 * notices until a reconciliation.
 */
import { z } from 'zod';

/** $0.00–$1,000.00. Above that is a parse error, not a steak. */
export const MAX_PRICE_CENTS = 100_000;

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour like #B4472A');

/**
 * Only https, and only a plain host — the parsed URL is fetched later and
 * written into a page. `javascript:`, `data:` and a bare host name are all
 * rejected here rather than at the point of use.
 */
const imageUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith('https://'), 'must be https')
  .refine((u) => !/^https:\/\/(localhost|127\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.)/i.test(u),
    'must not point at a private or loopback address');

export const priceCents = z
  .number({ error: 'price must be a number of cents' })
  .int('price must be whole cents, not a decimal amount')
  .min(0, 'price cannot be negative')
  .max(MAX_PRICE_CENTS, `price cannot exceed ${MAX_PRICE_CENTS} cents`);

/**
 * Decode the HTML entities a page leaves in its own JSON-LD.
 *
 * kwickmenu publishes `5pc Wings&amp;shrimp` inside its structured menu. The
 * markup is decoded by a browser; JSON-LD read straight out of a <script> tag
 * is not, so the entity travels all the way onto a storefront and is shown to
 * the restaurant as their own menu item. Numeric and named forms both appear.
 */
export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
    ldquo: '“', rdquo: '”', deg: '°', frac12: '½', frac14: '¼', frac34: '¾',
  }
  return value
    // Repeat once: `&amp;amp;` is a real thing on double-encoded pages.
    .replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16))
      if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)))
      return named[body.toLowerCase()] ?? whole
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (whole, body: string) => named[body.toLowerCase()] ?? whole)
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** A display string as it should reach a storefront: decoded and trimmed. */
const displayText = (max: number) => z.string().trim().transform(decodeEntities).pipe(z.string().min(1).max(max))
const optionalText = (max: number) => z.string().trim().transform(decodeEntities).pipe(z.string().max(max)).nullable().default(null)

export const parsedItemSchema = z.object({
  name: displayText(120),
  description: optionalText(600),
  priceCents,
  /** Only when the page states it plainly. Guessed calories are invented facts. */
  calories: z.number().int().min(0).max(10_000).nullable().default(null),
  imageUrl: imageUrl.nullable().default(null),
});

export const parsedCategorySchema = z.object({
  name: displayText(80),
  description: optionalText(400),
  items: z.array(parsedItemSchema).min(1).max(200),
});

export const parsedBrandingSchema = z.object({
  primaryColor: hexColor.nullable().default(null),
  accentColor: hexColor.nullable().default(null),
  logoUrl: imageUrl.nullable().default(null),
  heroUrl: imageUrl.nullable().default(null),
});

export const parsedRestaurantSchema = z.object({
  name: displayText(160),
  /** Free-text, as printed. Never normalised into a claim about cuisine. */
  cuisine: optionalText(80),
  branding: parsedBrandingSchema,
  categories: z.array(parsedCategorySchema).min(1).max(40),
  /** The page each fact came from, for the provenance column on every item. */
  sourceUrl: z.string().trim().url(),
});

export type ParsedItem = z.infer<typeof parsedItemSchema>;
export type ParsedCategory = z.infer<typeof parsedCategorySchema>;
export type ParsedBranding = z.infer<typeof parsedBrandingSchema>;
export type ParsedRestaurant = z.infer<typeof parsedRestaurantSchema>;

/** Total items across categories — the number the claim page shows an owner. */
export function itemCount(parsed: ParsedRestaurant): number {
  return parsed.categories.reduce((n, c) => n + c.items.length, 0);
}

/**
 * Turn a display price into whole cents, or fail.
 *
 * Accepts "$12.99", "12.99", "12", "1,299.00". Refuses "market price", "MP",
 * "12.999" and an empty string — a menu line without a number is not a
 * zero-priced item, it is a line this pipeline cannot stage.
 */
export function parsePriceToCents(raw: unknown): { cents: number } | { error: string } {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { error: 'price is not a finite number' };
    // A whole number is already cents ONLY if the caller says so; here a bare
    // number is dollars, because that is what a page shows.
    const cents = Math.round(raw * 100);
    return Number.isInteger(raw * 100) || Math.abs(raw * 100 - cents) < 1e-6
      ? { cents }
      : { error: 'price has sub-cent precision' };
  }
  if (typeof raw !== 'string') return { error: 'price is missing' };
  const s = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!s) return { error: 'price is empty' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: `price ${JSON.stringify(raw)} is not a plain amount` };
  const [whole, frac = ''] = s.split('.');
  return { cents: Number(whole) * 100 + Number(frac.padEnd(2, '0')) };
}

/** URL-safe slug, stable for the same name so a re-parse upserts rather than duplicates. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
