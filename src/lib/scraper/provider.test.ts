import { describe, expect, it } from 'vitest';
import { FakeMenuParser, parseStructured, resolveProviderName } from './provider';
import { parsedRestaurantSchema } from './schema';

const jsonLd = (body: unknown) => `<html><head>
<script type="application/ld+json">${JSON.stringify(body)}</script>
</head><body>menu</body></html>`;

const RESTAURANT = {
  '@context': 'https://schema.org',
  '@type': 'Restaurant',
  name: 'Copper Pot Cafe',
  servesCuisine: 'Southern',
  logo: 'https://cdn.example/logo.png',
  image: { '@type': 'ImageObject', url: 'https://cdn.example/hero.jpg' },
  hasMenu: {
    '@type': 'Menu',
    hasMenuSection: [
      {
        '@type': 'MenuSection',
        name: 'Mains',
        description: 'Served all day',
        hasMenuItem: [
          { '@type': 'MenuItem', name: 'Gumbo', description: 'Andouille and okra', offers: { '@type': 'Offer', price: '16.50' } },
          { '@type': 'MenuItem', name: 'Catfish', offers: { '@type': 'Offer', price: 18 } },
          { '@type': 'MenuItem', name: 'Whole Snapper', offers: { '@type': 'Offer', price: 'market price' } },
        ],
      },
    ],
  },
};

describe('structured parsing', () => {
  it('reads a schema.org menu into the staging shape', () => {
    const raw = parseStructured({ content: jsonLd(RESTAURANT), sourceUrl: 'https://copperpot.example/menu' });
    const parsed = parsedRestaurantSchema.parse(raw);
    expect(parsed.name).toBe('Copper Pot Cafe');
    expect(parsed.cuisine).toBe('Southern');
    expect(parsed.branding.logoUrl).toBe('https://cdn.example/logo.png');
    expect(parsed.branding.heroUrl).toBe('https://cdn.example/hero.jpg');
    expect(parsed.categories[0].items.map((i) => [i.name, i.priceCents])).toEqual([
      ['Gumbo', 1650],
      ['Catfish', 1800],
    ]);
  });

  it('drops the market-price item instead of pricing it at zero', () => {
    const raw = parseStructured({ content: jsonLd(RESTAURANT), sourceUrl: 'https://x.example' })!;
    const names = (raw.categories as { items: { name: string }[] }[])[0].items.map((i) => i.name);
    expect(names).not.toContain('Whole Snapper');
  });

  it('never invents a colour it was not given', () => {
    const raw = parseStructured({ content: jsonLd(RESTAURANT), sourceUrl: 'https://x.example' })!;
    expect((raw.branding as { primaryColor: unknown }).primaryColor).toBeNull();
  });

  it('returns null for a page with no menu markup', () => {
    expect(parseStructured({ content: '<html><body><h1>We are closed</h1></body></html>', sourceUrl: 'https://x.example' })).toBeNull();
    expect(parseStructured({ content: jsonLd({ '@type': 'Restaurant', name: 'No Menu Diner' }), sourceUrl: 'https://x.example' })).toBeNull();
  });

  it('ignores a section that ends up with no priceable items', () => {
    const raw = parseStructured({
      content: jsonLd({ ...RESTAURANT, hasMenu: { hasMenuSection: [{ '@type': 'MenuSection', name: 'Specials', hasMenuItem: [{ '@type': 'MenuItem', name: 'Ask', offers: { price: 'MP' } }] }] } }),
      sourceUrl: 'https://x.example',
    });
    expect(raw).toBeNull();
  });
});

describe('the fake parser', () => {
  it('parses real markup rather than returning a canned fixture', async () => {
    const out = await new FakeMenuParser().parse({ content: jsonLd(RESTAURANT), sourceUrl: 'https://x.example' });
    expect((out.categories as unknown[]).length).toBe(1);
  });

  it('yields an empty menu for a page it cannot read', async () => {
    const out = await new FakeMenuParser().parse({ content: '<p>hello</p>', sourceUrl: 'https://x.example', nameHint: 'Somewhere' });
    expect(out).toEqual({ name: 'Somewhere', categories: [] });
  });
});

describe('provider selection', () => {
  it('uses the model only when a key exists, and an explicit choice always wins', () => {
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(resolveProviderName(env({}))).toBe('fake');
    expect(resolveProviderName(env({ ANTHROPIC_API_KEY: '  ' }))).toBe('fake');
    expect(resolveProviderName(env({ ANTHROPIC_API_KEY: 'sk-x' }))).toBe('anthropic');
    expect(resolveProviderName(env({ ANTHROPIC_API_KEY: 'sk-x', MENU_PARSER_PROVIDER: 'fake' }))).toBe('fake');
  });
});
