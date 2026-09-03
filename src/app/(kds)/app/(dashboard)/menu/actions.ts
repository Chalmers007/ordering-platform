'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { fail, ok, type ActionResult } from '@/types/database';

/**
 * Menu management.
 *
 * Every action re-derives the tenant from the session and never accepts one
 * from the client. RLS would refuse a cross-tenant write anyway, but a
 * request that cannot express the wrong tenant cannot be the thing that
 * finds a hole in a policy.
 */

function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'item'
  );
}

/** Slugs are unique per tenant, and a menu legitimately contains "Small"
 *  twice. Suffix rather than fail on a name collision. */
async function uniqueSlug(
  table: 'menu_items' | 'menu_categories',
  tenantId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  const supabase = await createClientForRequest();
  let candidate = slugify(base);

  for (let attempt = 2; attempt < 50; attempt += 1) {
    let query = supabase
      .from(table)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('slug', candidate)
      .limit(1);
    if (excludeId) query = query.neq('id', excludeId);

    const { data } = await query;
    if (!data?.length) return candidate;
    candidate = `${slugify(base)}-${attempt}`;
  }
  return `${slugify(base)}-${Date.now()}`;
}

function refused(code: string | undefined, fallback: string): string {
  if (code === '42501') return 'You do not have permission to change the menu.';
  if (code === '23505') return 'Something with that name already exists.';
  if (code === '23514') return 'One of those values is out of range.';
  return fallback;
}

async function tenantOrFail() {
  const staff = await resolveStaffTenantId();
  return staff?.tenantId ?? null;
}

// ---------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------

export async function createCategory(name: string): Promise<ActionResult<{ id: string }>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });
  if (!name.trim()) return fail('A category needs a name', { code: 'validation' });

  const supabase = await createClientForRequest();
  const { count } = await supabase
    .from('menu_categories')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const { data, error } = await supabase
    .from('menu_categories')
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      slug: await uniqueSlug('menu_categories', tenantId, name),
      sort_order: count ?? 0,
    })
    .select('id')
    .single();

  if (error || !data) return fail(refused(error?.code, error?.message ?? 'Failed'), { code: 'unknown' });
  revalidatePath('/menu');
  return ok({ id: data.id });
}

export async function renameCategory(id: string, name: string): Promise<ActionResult<void>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });

  const supabase = await createClientForRequest();
  const { error } = await supabase
    .from('menu_categories')
    .update({ name: name.trim() })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
  revalidatePath('/menu');
  return ok(undefined);
}

export async function deleteCategory(id: string): Promise<ActionResult<void>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });

  const supabase = await createClientForRequest();

  // Deleting a category sets its items' category_id to NULL rather than
  // removing them, so a mis-click cannot destroy a menu. Refuse instead,
  // and say what to do.
  const { count } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('category_id', id);

  if (count && count > 0) {
    return fail(
      `That category still has ${count} item${count === 1 ? '' : 's'}. Move or delete them first.`,
      { code: 'conflict' },
    );
  }

  const { error } = await supabase
    .from('menu_categories')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
  revalidatePath('/menu');
  return ok(undefined);
}

export async function reorderCategories(orderedIds: string[]): Promise<ActionResult<void>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });

  const supabase = await createClientForRequest();
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from('menu_categories')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
  }

  revalidatePath('/menu');
  return ok(undefined);
}

// ---------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid().nullable(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  imagePath: z.string().max(512).optional(),
  isAvailable: z.boolean(),
  isTaxable: z.boolean(),
  dietaryTags: z.array(z.string().max(40)).max(12).optional(),
  modifierGroupIds: z.array(z.string().uuid()).max(20).optional(),
});

export async function saveItem(
  input: z.infer<typeof itemSchema>,
): Promise<ActionResult<{ id: string }>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });

  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return fail('Check the item details', {
      code: 'validation',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    });
  }
  const data = parsed.data;
  const supabase = await createClientForRequest();

  const row = {
    tenant_id: tenantId,
    category_id: data.categoryId,
    name: data.name.trim(),
    description: data.description?.trim() || null,
    price_cents: data.priceCents,
    image_path: data.imagePath?.trim() || null,
    is_available: data.isAvailable,
    is_taxable: data.isTaxable,
    dietary_tags: data.dietaryTags ?? [],
  };

  let itemId = data.id;

  if (itemId) {
    const { error } = await supabase
      .from('menu_items')
      .update(row)
      .eq('id', itemId)
      .eq('tenant_id', tenantId);
    if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
  } else {
    const { data: created, error } = await supabase
      .from('menu_items')
      .insert({ ...row, slug: await uniqueSlug('menu_items', tenantId, data.name) })
      .select('id')
      .single();
    if (error || !created) {
      return fail(refused(error?.code, error?.message ?? 'Failed'), { code: 'unknown' });
    }
    itemId = created.id;
  }

  // Modifier mapping is replace-not-merge: the form shows the complete set,
  // so an unchecked group must actually detach.
  if (data.modifierGroupIds) {
    await supabase
      .from('menu_item_modifier_groups')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId);

    if (data.modifierGroupIds.length > 0) {
      const { error } = await supabase.from('menu_item_modifier_groups').insert(
        data.modifierGroupIds.map((groupId, index) => ({
          tenant_id: tenantId,
          item_id: itemId!,
          group_id: groupId,
          sort_order: index,
        })),
      );
      if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
    }
  }

  revalidatePath('/menu');
  return ok({ id: itemId });
}

export async function setItemAvailability(
  id: string,
  isAvailable: boolean,
): Promise<ActionResult<void>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });

  const supabase = await createClientForRequest();
  const { error } = await supabase
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
  revalidatePath('/menu');
  return ok(undefined);
}

export async function deleteItem(id: string): Promise<ActionResult<void>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });

  const supabase = await createClientForRequest();
  const { error } = await supabase.from('menu_items').delete().eq('id', id).eq('tenant_id', tenantId);

  if (error) return fail(refused(error.code, error.message), { code: 'unknown' });
  revalidatePath('/menu');
  return ok(undefined);
}

// ---------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------

const importRow = z.object({
  category: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional().default(''),
  /** Dollars in the file, cents in the database. */
  price: z.coerce.number().min(0).max(10_000),
  available: z.coerce.boolean().optional().default(true),
});

export type ImportSummary = {
  categoriesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  skipped: { row: number; reason: string }[];
};

export async function importMenu(rows: unknown[]): Promise<ActionResult<ImportSummary>> {
  const tenantId = await tenantOrFail();
  if (!tenantId) return fail('No access', { code: 'forbidden' });
  if (!Array.isArray(rows) || rows.length === 0) {
    return fail('That file had no rows in it', { code: 'validation' });
  }
  if (rows.length > 1000) {
    return fail('That file has more than 1000 rows. Split it and import again.', {
      code: 'validation',
    });
  }

  const supabase = await createClientForRequest();
  const summary: ImportSummary = {
    categoriesCreated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    skipped: [],
  };

  const { data: existingCategories } = await supabase
    .from('menu_categories')
    .select('id, name')
    .eq('tenant_id', tenantId);

  const categoryIds = new Map(
    (existingCategories ?? []).map((c) => [c.name.toLowerCase(), c.id] as const),
  );

  const { data: existingItems } = await supabase
    .from('menu_items')
    .select('id, name')
    .eq('tenant_id', tenantId);

  const itemIds = new Map((existingItems ?? []).map((i) => [i.name.toLowerCase(), i.id] as const));

  for (const [index, raw] of rows.entries()) {
    const parsed = importRow.safeParse(raw);
    if (!parsed.success) {
      // One malformed row must not abandon the other 300.
      summary.skipped.push({
        row: index + 1,
        reason: parsed.error.issues[0]?.message ?? 'invalid row',
      });
      continue;
    }
    const row = parsed.data;
    const key = row.category.toLowerCase();

    let categoryId = categoryIds.get(key);
    if (!categoryId) {
      const { data: created, error } = await supabase
        .from('menu_categories')
        .insert({
          tenant_id: tenantId,
          name: row.category.trim(),
          slug: await uniqueSlug('menu_categories', tenantId, row.category),
          sort_order: categoryIds.size,
        })
        .select('id')
        .single();

      if (error || !created) {
        summary.skipped.push({ row: index + 1, reason: refused(error?.code, 'category failed') });
        continue;
      }
      categoryId = created.id;
      categoryIds.set(key, categoryId);
      summary.categoriesCreated += 1;
    }

    const priceCents = Math.round(row.price * 100);
    const existingId = itemIds.get(row.name.toLowerCase());

    if (existingId) {
      const { error } = await supabase
        .from('menu_items')
        .update({
          category_id: categoryId,
          description: row.description || null,
          price_cents: priceCents,
          is_available: row.available,
        })
        .eq('id', existingId)
        .eq('tenant_id', tenantId);

      if (error) summary.skipped.push({ row: index + 1, reason: refused(error.code, 'update failed') });
      else summary.itemsUpdated += 1;
      continue;
    }

    const { data: created, error } = await supabase
      .from('menu_items')
      .insert({
        tenant_id: tenantId,
        category_id: categoryId,
        name: row.name.trim(),
        slug: await uniqueSlug('menu_items', tenantId, row.name),
        description: row.description || null,
        price_cents: priceCents,
        is_available: row.available,
        is_taxable: true,
      })
      .select('id')
      .single();

    if (error || !created) {
      summary.skipped.push({ row: index + 1, reason: refused(error?.code, 'insert failed') });
      continue;
    }
    itemIds.set(row.name.toLowerCase(), created.id);
    summary.itemsCreated += 1;
  }

  revalidatePath('/menu');
  return ok(summary);
}
