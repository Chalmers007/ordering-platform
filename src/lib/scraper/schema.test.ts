import { describe, expect, it } from 'vitest';
import { decodeEntities, parsePriceToCents, parsedRestaurantSchema, slugify, itemCount, MAX_PRICE_CENTS } from './schema';

describe('parsePriceToCents', () => {
  it('reads the shapes a menu page actually prints', () => {
    expect(parsePriceToCents('$12.99')).toEqual({ cents: 1299 });
    expect(parsePriceToCents('12.99')).toEqual({ cents: 1299 });
    expect(parsePriceToCents('12')).toEqual({ cents: 1200 });
    expect(parsePriceToCents('1,299.00')).toEqual({ cents: 129900 });
    expect(parsePriceToCents('12.5')).toEqual({ cents: 1250 });
    expect(parsePriceToCents(12.99)).toEqual({ cents: 1299 });
  });

  it('refuses a line it cannot price rather than guessing one', () => {
    // Every one of these would otherwise become a real price on a real
    // storefront. "market price" as 0 is the worst of them: free lobster.
    for (const raw of ['market price', 'MP', '', '  ', '10-14', '$', 'twelve', null, undefined, {}, NaN]) {
      expect(parsePriceToCents(raw as unknown)).toHaveProperty('error');
    }
  });

  it('never introduces a floating-point cent', () => {
    // 12.99 * 100 is 1298.9999999999998 in IEEE 754.
    for (const dollars of [12.99, 0.07, 8.15, 19.99, 1.1, 33.33]) {
      const out = parsePriceToCents(String(dollars));
      expect(out).toEqual({ cents: Math.round(dollars * 100) });
      expect(Number.isInteger((out as { cents: number }).cents)).toBe(true);
    }
  });
});

describe('parsedRestaurantSchema', () => {
  const valid = {
    name: 'Copper Pot Cafe',
    cuisine: 'Southern',
    branding: { primaryColor: '#B4472A', accentColor: null, logoUrl: null, heroUrl: null },
    categories: [{ name: 'Mains', description: null, items: [{ name: 'Gumbo', description: null, priceCents: 1650, calories: null, imageUrl: null }] }],
    sourceUrl: 'https://copperpot.example/menu',
  };

  it('accepts a well-formed parse', () => {
    const out = parsedRestaurantSchema.parse(valid);
    expect(itemCount(out)).toBe(1);
  });

  it('rejects a price that is a decimal, negative, or absurd', () => {
    for (const priceCents of [16.5, -1, MAX_PRICE_CENTS + 1]) {
      const bad = structuredClone(valid);
      bad.categories[0].items[0].priceCents = priceCents;
      expect(parsedRestaurantSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects an image URL that is not a public https address', () => {
    // A parsed URL gets written into a page. javascript:, data: and an
    // internal address are all rejected here rather than at the point of use.
    for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'http://x.example/a.png',
                            'https://127.0.0.1/a.png', 'https://192.168.1.5/a.png', 'https://localhost/a.png']) {
      const bad = structuredClone(valid);
      (bad.categories[0].items[0] as { imageUrl: string | null }).imageUrl = imageUrl;
      expect(parsedRestaurantSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects a colour that is not a 6-digit hex', () => {
    for (const primaryColor of ['red', '#fff', 'rgb(1,2,3)', '#GGGGGG']) {
      const bad = structuredClone(valid);
      (bad.branding as { primaryColor: string }).primaryColor = primaryColor;
      expect(parsedRestaurantSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects an empty menu — a page with no items is not a restaurant to stage', () => {
    const bad = structuredClone(valid);
    bad.categories = [];
    expect(parsedRestaurantSchema.safeParse(bad).success).toBe(false);
  });
});

describe('slugify', () => {
  it('is stable, so a re-parse upserts instead of duplicating', () => {
    expect(slugify('Wood-Fired Margherita')).toBe('wood-fired-margherita');
    expect(slugify('  Café  Crème  ')).toBe(slugify('Café Crème'));
    expect(slugify('Chef’s Special!!')).toBe('chef-s-special');
  });
});

describe('HTML entities in a page’s own structured data', () => {
  it('are decoded before they reach a storefront', () => {
    // kwickmenu publishes `5pc Wings&amp;shrimp` inside its JSON-LD. A browser
    // decodes that; a <script> tag read directly does not, so without this the
    // restaurant is shown their own menu item spelled wrong.
    expect(decodeEntities('5pc Wings&amp;shrimp')).toBe('5pc Wings&shrimp');
    expect(decodeEntities('Fish &amp; Chips')).toBe('Fish & Chips');
    expect(decodeEntities('Caf&eacute; special')).toBe('Caf&eacute; special'); // unknown named entity left alone
    expect(decodeEntities('Mac &#38; Cheese')).toBe('Mac & Cheese');
    expect(decodeEntities('Jalape&#241;o Poppers')).toBe('Jalapeño Poppers');
    expect(decodeEntities('Half &frac12; portion')).toBe('Half ½ portion');
    expect(decodeEntities('Double &amp;amp; encoded')).toBe('Double & encoded');
    expect(decodeEntities('  spaced   out  ')).toBe('spaced out');
  });

  it('decoding runs inside the schema, not only as a helper', () => {
    const parsed = parsedRestaurantSchema.parse({
      name: 'Cajun Seafood &amp; Grill',
      cuisine: null,
      branding: { primaryColor: null, accentColor: null, logoUrl: null, heroUrl: null },
      categories: [{ name: 'Wings &amp; Things', description: null, items: [{ name: '5pc Wings&amp;shrimp', description: null, priceCents: 1399, calories: null, imageUrl: null }] }],
      sourceUrl: 'https://x.example/menu',
    });
    expect(parsed.name).toBe('Cajun Seafood & Grill');
    expect(parsed.categories[0].name).toBe('Wings & Things');
    expect(parsed.categories[0].items[0].name).toBe('5pc Wings&shrimp');
  });
});
