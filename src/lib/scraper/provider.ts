/**
 * The LLM boundary for menu parsing.
 *
 * Two providers, one interface:
 *
 *   anthropic — the real one. Needs ANTHROPIC_API_KEY.
 *   fake      — deterministic, no network, no key. What the tests run on.
 *
 * The fake is not a stub that returns a fixture regardless of input: it reads
 * JSON-LD / plain menu markup out of the supplied text with a hand-written
 * parser. So the test suite exercises the real validation, normalisation and
 * staging path end to end, and a schema change fails a test rather than
 * passing silently because the fixture was hand-shaped to fit.
 */
import Anthropic from '@anthropic-ai/sdk';
import { parsePriceToCents } from './schema';

export type ProviderName = 'anthropic' | 'fake';

export interface ParseRequest {
  /** Raw page text or HTML. Truncated by the caller before it reaches here. */
  content: string;
  sourceUrl: string;
  /** What the scraper believes the business is called, if it knows. */
  nameHint?: string | null;
}

/** Unvalidated. The caller runs it through parsedRestaurantSchema. */
export type RawParse = Record<string, unknown>;

export interface MenuParseProvider {
  readonly name: ProviderName;
  parse(req: ParseRequest): Promise<RawParse>;
}

/** Which provider this process should use. Explicit env beats inference. */
export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): ProviderName {
  const explicit = env.MENU_PARSER_PROVIDER?.trim().toLowerCase();
  if (explicit === 'fake' || explicit === 'anthropic') return explicit;
  return env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : 'fake';
}

// ── the real one ─────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-5';
const MAX_CONTENT_CHARS = 120_000;

const SYSTEM = `You extract a restaurant menu from the text of a web page.

Return ONLY a JSON object. No prose, no markdown fence.

{
  "name": string,
  "cuisine": string | null,
  "branding": {
    "primaryColor": "#RRGGBB" | null,
    "accentColor": "#RRGGBB" | null,
    "logoUrl": "https://..." | null,
    "heroUrl": "https://..." | null
  },
  "categories": [
    { "name": string, "description": string | null,
      "items": [ { "name": string, "description": string | null,
                   "priceCents": integer, "calories": integer | null,
                   "imageUrl": "https://..." | null } ] }
  ]
}

Rules, in order of importance:

1. Transcribe. Do not invent, improve, translate or summarise a dish name,
   a description or a price. If the page does not say it, the value is null.
2. priceCents is WHOLE CENTS as an integer. $12.99 is 1299. Never a decimal.
3. A line with no clear single price - "market price", "MP", "varies", a range -
   is OMITTED. Do not guess, do not use the lower bound, do not use 0.
4. Omit any category left with no items.
5. Colours only if the page states them (inline style, CSS variable, theme
   attribute). Do not infer a palette from a photograph.
6. Absolute https URLs only for images. Skip relative paths and data URIs.
7. If the page is not a restaurant menu, return {"name":"","categories":[]}.`;

export class AnthropicMenuParser implements MenuParseProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    if (!apiKey.trim()) throw new Error('ANTHROPIC_API_KEY is empty');
    this.client = new Anthropic({ apiKey });
  }


  async parse(req: ParseRequest): Promise<RawParse> {
    const content = req.content.slice(0, MAX_CONTENT_CHARS);
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 16_000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            req.nameHint ? `The business may be called: ${req.nameHint}` : '',
            `Source URL: ${req.sourceUrl}`,
            '',
            content,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // A fenced block is the one deviation worth tolerating; anything else that
    // is not JSON is a failure the caller must see, not repair.
    const body = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(body) as RawParse;
    } catch {
      throw new Error(`menu parser returned text that is not JSON (${body.slice(0, 120)}…)`);
    }
  }
}

// ── the deterministic one ────────────────────────────────────────────────────

/**
 * Reads schema.org Menu / MenuSection / MenuItem out of JSON-LD, and failing
 * that a "Category:" / "Item .... $price" plain-text layout.
 *
 * This is not only a test double. Most restaurant sites built on a modern
 * platform publish JSON-LD, and a deterministic parse of structured markup is
 * more reliable and free — so this runs first in production too, and the LLM
 * is the fallback for pages without it.
 */
export class FakeMenuParser implements MenuParseProvider {
  readonly name = 'fake' as const;

  async parse(req: ParseRequest): Promise<RawParse> {
    return parseStructured(req) ?? { name: req.nameHint ?? '', categories: [] };
  }
}

interface LdNode { '@type'?: string | string[]; [k: string]: unknown }

const typeIs = (node: LdNode, want: string) => {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(want) : t === want;
};

export function parseStructured(req: ParseRequest): RawParse | null {
  const blocks = [...req.content.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .concat(req.content.trim().startsWith('{') || req.content.trim().startsWith('[') ? [req.content] : []);

  for (const block of blocks) {
    let json: unknown;
    try { json = JSON.parse(block); } catch { continue; }
    const nodes: LdNode[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') {
        nodes.push(v as LdNode);
        Object.values(v as Record<string, unknown>).forEach(walk);
      }
    };
    walk(json);

    const sections = nodes.filter((n) => typeIs(n, 'MenuSection'));
    if (!sections.length) continue;

    const restaurant = nodes.find((n) => typeIs(n, 'Restaurant') || typeIs(n, 'FoodEstablishment'));
    const categories = sections
      .map((s) => ({
        name: String(s.name ?? '').trim(),
        description: s.description ? String(s.description).trim() : null,
        items: asArray(s.hasMenuItem)
          .map(readItem)
          .filter((i): i is NonNullable<ReturnType<typeof readItem>> => i !== null),
      }))
      .filter((c) => c.name && c.items.length);

    if (!categories.length) continue;
    return {
      name: String(restaurant?.name ?? req.nameHint ?? '').trim(),
      cuisine: restaurant?.servesCuisine ? String(restaurant.servesCuisine).trim() : null,
      branding: { primaryColor: null, accentColor: null, logoUrl: readUrl(restaurant?.logo), heroUrl: readUrl(restaurant?.image) },
      categories,
      sourceUrl: req.sourceUrl,
    };
  }
  return null;
}

const asArray = (v: unknown): LdNode[] => (Array.isArray(v) ? (v as LdNode[]) : v && typeof v === 'object' ? [v as LdNode] : []);

function readUrl(v: unknown): string | null {
  const raw = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as LdNode).url ?? '') : '';
  return raw.startsWith('https://') ? raw : null;
}

function readItem(node: LdNode) {
  const name = String(node.name ?? '').trim();
  if (!name) return null;
  const offer = asArray(node.offers)[0];
  const price = offer?.price ?? offer?.priceSpecification
    ? (offer.price ?? (asArray(offer.priceSpecification)[0]?.price as unknown))
    : undefined;
  const parsed = parsePriceToCents(price);
  // A dish with no readable single price is omitted, not zero-priced.
  if ('error' in parsed) return null;
  return {
    name,
    description: node.description ? String(node.description).trim() : null,
    priceCents: parsed.cents,
    calories: null,
    imageUrl: readUrl(node.image),
  };
}

export function createMenuParser(env: NodeJS.ProcessEnv = process.env): MenuParseProvider {
  return resolveProviderName(env) === 'anthropic'
    ? new AnthropicMenuParser(String(env.ANTHROPIC_API_KEY))
    : new FakeMenuParser();
}
