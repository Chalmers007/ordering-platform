import { describe, it, expect } from 'vitest';
import { FOOD_IMAGES, FOOD_ITEM_IMAGES, generateSampleMenu, sampleMenuContent } from './fallback';
import { parseStructured } from '@/lib/scraper/provider';

describe('Demo Fallback', () => {
  describe('generateSampleMenu', () => {
    it('generates a sample menu with 3 categories', () => {
      const menu = generateSampleMenu();
      expect(menu.categories).toHaveLength(3);
    });

    it('ensures each category has approximately 10 items', () => {
      const menu = generateSampleMenu();
      menu.categories.forEach((category) => {
        expect(category.items.length).toBeGreaterThanOrEqual(9);
        expect(category.items.length).toBeLessThanOrEqual(11);
      });
    });

    it('generates categories with names', () => {
      const menu = generateSampleMenu();
      const categoryNames = menu.categories.map((c) => c.name);
      expect(categoryNames).toContain('Appetizers');
      expect(categoryNames).toContain('Entrées');
      expect(categoryNames).toContain('Desserts');
    });

    it('generates items with required fields', () => {
      const menu = generateSampleMenu();
      menu.categories.forEach((category) => {
        category.items.forEach((item) => {
          expect(item.name).toBeTruthy();
          expect(item.name.length).toBeGreaterThan(0);
          expect(typeof item.priceCents).toBe('number');
          expect(item.priceCents).toBeGreaterThan(0);
        });
      });
    });

    it('generates realistic prices', () => {
      const menu = generateSampleMenu();
      const allItems = menu.categories.flatMap((c) => c.items);
      const prices = allItems.map((i) => i.priceCents);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      // Prices should be between $1 and $300
      expect(minPrice).toBeGreaterThanOrEqual(100);
      expect(maxPrice).toBeLessThanOrEqual(300000);
    });

    it('does not repeat item names within categories', () => {
      const menu = generateSampleMenu();
      menu.categories.forEach((category) => {
        const names = category.items.map((i) => i.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
      });
    });

    it('selects cuisine-specific categories for demo food types', () => {
      expect(generateSampleMenu('Mexican').categories.map((category) => category.name)).toEqual([
        'Tacos', 'Burritos & Bowls', 'Chips & Sweets',
      ]);
      expect(generateSampleMenu('Asian Fusion').categories.map((category) => category.name)).toEqual([
        'Sushi & Small Plates', 'Ramen & Rice', 'Dessert & Drinks',
      ]);
      expect(generateSampleMenu('Pizza').categories[0]?.items[0]?.name).toBe('Margherita');
      expect(generateSampleMenu('Burger').categories[0]?.name).toBe('Burgers');
      expect(generateSampleMenu('Italian').categories[0]?.name).toBe('Pasta');
    });

    it('includes descriptions for most items', () => {
      const menu = generateSampleMenu();
      const allItems = menu.categories.flatMap((c) => c.items);
      const itemsWithDescription = allItems.filter((i) => i.description);
      // Expect at least 80% of items to have descriptions
      expect(itemsWithDescription.length).toBeGreaterThan(allItems.length * 0.8);
    });

    it('attaches category-aligned image URLs to generated items', () => {
      const menu = generateSampleMenu('Mexican');
      expect(menu.categories[0]?.items[0]?.imageUrl).toBe(FOOD_IMAGES.tacos);
      expect(generateSampleMenu('Pizza').categories[0]?.items[0]?.imageUrl).toBe(FOOD_IMAGES.pizza);
      expect(generateSampleMenu('Burger').categories[0]?.items[0]?.imageUrl).toBe(FOOD_IMAGES.burger);
      expect(generateSampleMenu('Italian').categories[0]?.items[0]?.imageUrl).toBe(FOOD_IMAGES.pasta);
      expect(generateSampleMenu('Asian Fusion').categories[0]?.items[0]?.imageUrl).toBe(FOOD_IMAGES.sushi);
    });

    it('prioritizes dish-specific image URLs over category defaults', () => {
      const items = generateSampleMenu().categories.flatMap((category) => category.items);
      for (const [name, url] of Object.entries(FOOD_ITEM_IMAGES)) {
        const item = items.find((candidate) => candidate.name.toLowerCase().includes(name));
        if (item) expect(item.imageUrl).toBe(url);
      }
      expect(items.every((item) => typeof item.imageUrl === 'string' && item.imageUrl.startsWith('https://'))).toBe(true);
    });
  });

  describe('sample menu structure', () => {
    it('uses the structured parser format for fallback staging', () => {
      const parsed = parseStructured({
        content: sampleMenuContent('Test Restaurant'),
        sourceUrl: 'sample-menu://fallback-demo',
        nameHint: 'Test Restaurant',
      });
      expect(parsed?.name).toBe('Test Restaurant');
      expect(parsed?.categories).toHaveLength(3);
      const categories = parsed?.categories as Array<{ items: unknown[] }>;
      expect(categories.flatMap((category) => category.items)).toHaveLength(30);
    });

    it('follows expected category order', () => {
      const menu = generateSampleMenu();
      const categoryNames = menu.categories.map((c) => c.name);
      expect(categoryNames[0]).toBe('Appetizers');
      expect(categoryNames[1]).toBe('Entrées');
      expect(categoryNames[2]).toBe('Desserts');
    });

    it('has proper JSON structure for serialization', () => {
      const menu = generateSampleMenu();
      const json = JSON.stringify(menu);
      const parsed = JSON.parse(json);
      expect(parsed.categories).toHaveLength(3);
    });

    it('includes item images in the structured fallback payload', () => {
      const payload = JSON.parse(sampleMenuContent('Taco House', 'Mexican')) as {
        '@graph': Array<{ hasMenuItem?: Array<{ image?: string }> }>;
      };
      const image = payload['@graph']
        .filter((section) => section.hasMenuItem?.some((item) => item.image))
        .flatMap((section) => section.hasMenuItem ?? [])[0]?.image;
      expect(image).toBe(FOOD_IMAGES.tacos);
    });
  });
});
