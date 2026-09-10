import { z } from 'zod';

const optionalText = z.string().trim().max(500).optional().or(z.literal(''));

export const demoCreateSchema = z.object({
  name: z.string().trim().min(1, 'Business name is required').max(200),
  website: z.string().trim().url('Website must be a valid URL').optional().or(z.literal('')),
  foodType: optionalText,
  slug: z.string().trim().min(1).max(100).optional().or(z.literal('')),
  address: optionalText,
});

function firstValue(formData: FormData, ...names: string[]): string {
  for (const name of names) {
    const value = formData.get(name)?.toString().trim();
    if (value) return value;
  }
  return '';
}

/** Normalize legacy and sales-builder field names before validation. */
export function normalizeDemoInput(formData: FormData) {
  return {
    name: firstValue(formData, 'name', 'business_name', 'businessName'),
    website: firstValue(formData, 'website', 'website_url', 'websiteUrl') || undefined,
    foodType: firstValue(formData, 'food_type', 'foodType', 'category') || undefined,
    slug: firstValue(formData, 'slug') || undefined,
    address: firstValue(formData, 'address') || undefined,
  };
}
