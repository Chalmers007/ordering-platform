'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClientForRequest } from '@/lib/supabase/server';
import { resolveStaffTenantId } from '@/lib/admin/guard';
import { fail, ok, type ActionResult, type TableUpdate } from '@/types/database';

/**
 * Store settings.
 *
 * Split across two tables on purpose, which the form hides but the writes
 * cannot: identity and contact live on `tenants`, everything operational
 * lives on `tenant_settings`. They also have different permissions — RLS
 * lets any member update tenant_settings so staff can pace the kitchen,
 * but only an owner may touch `tenants` at all.
 *
 * Nothing here is trusted to the client: the tenant comes from the session,
 * and the database re-checks every rule these actions assume.
 */

const HOURS = z.array(
  z.object({
    dow: z.number().int().min(0).max(6),
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  }),
);

const schema = z.object({
  // tenants — owner only
  name: z.string().min(1).max(160).optional(),
  supportEmail: z.string().email().max(254).or(z.literal('')).optional(),
  supportPhone: z.string().max(32).optional(),

  // tenant_settings — any member
  tagline: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  logoUrl: z.string().url().max(2048).or(z.literal('')).optional(),
  bannerUrl: z.string().url().max(2048).or(z.literal('')).optional(),
  // Constrained here AND by a CHECK constraint: these end up inside a
  // <style> tag on the tenant's storefront.
  primaryColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  accentColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  backgroundColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  fontFamily: z.string().regex(/^[A-Za-z0-9 ]{2,48}$/),
  acceptsDelivery: z.boolean(),
  acceptsPickup: z.boolean(),
  deliveryRadiusMeters: z.number().int().min(0).max(80_000),
  estimatedPrepTimeMins: z.number().int().min(0).max(240),
  isKitchenPaused: z.boolean(),
  businessHours: HOURS,

  // tenant_settings — money, owner only (a column guard trigger refuses staff)
  deliveryFeeCents: z.number().int().min(0).optional(),
  deliveryMinimumCents: z.number().int().min(0).optional(),
});

function messageFor(code: string | undefined, fallback: string): string {
  if (code === '42501') return 'Only the restaurant owner can change that.';
  if (code === '23514') return 'One of those values is out of range.';
  return fallback;
}

export async function saveStoreSettings(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ savedAt: string }>> {
  const staff = await resolveStaffTenantId();
  if (!staff) return fail('You do not have access to this restaurant', { code: 'forbidden' });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return fail('Some fields need attention', {
      code: 'validation',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    });
  }
  const data = parsed.data;

  if (data.acceptsDelivery === false && data.acceptsPickup === false) {
    return fail('A restaurant has to offer delivery, pickup, or both', {
      code: 'validation',
      fieldErrors: { acceptsPickup: ['Choose at least one fulfilment method'] },
    });
  }

  const supabase = await createClientForRequest();

  // ---- identity and contact (owner only) ------------------------------
  if (staff.canManage) {
    const { error } = await supabase
      .from('tenants')
      .update({
        ...(data.name ? { name: data.name.trim() } : {}),
        support_email: data.supportEmail?.trim() || null,
        support_phone: data.supportPhone?.trim() || null,
      })
      .eq('id', staff.tenantId);

    if (error) return fail(messageFor(error.code, error.message), { code: 'unknown' });
  }

  // ---- operational settings -------------------------------------------
  const settingsPatch: TableUpdate<'tenant_settings'> = {
    tagline: data.tagline?.trim() || null,
    description: data.description?.trim() || null,
    logo_url: data.logoUrl?.trim() || null,
    cover_image_url: data.bannerUrl?.trim() || null,
    brand_primary_color: data.primaryColor,
    brand_accent_color: data.accentColor,
    background_color: data.backgroundColor,
    font_family: data.fontFamily,
    accepts_delivery: data.acceptsDelivery,
    accepts_pickup: data.acceptsPickup,
    delivery_radius_meters: data.deliveryRadiusMeters,
    estimated_prep_time_mins: data.estimatedPrepTimeMins,
    business_hours: data.businessHours,
  };

  // Only send the money columns when the caller may change them. Sending
  // them unchanged would still trip the guard trigger, which compares
  // values rather than intent.
  if (staff.canManage) {
    if (data.deliveryFeeCents !== undefined) settingsPatch.delivery_fee_cents = data.deliveryFeeCents;
    if (data.deliveryMinimumCents !== undefined) {
      settingsPatch.delivery_minimum_cents = data.deliveryMinimumCents;
    }
  }

  const { error: settingsError } = await supabase
    .from('tenant_settings')
    .update(settingsPatch)
    .eq('tenant_id', staff.tenantId);

  if (settingsError) {
    return fail(messageFor(settingsError.code, settingsError.message), { code: 'unknown' });
  }

  // Pausing goes through its own RPC so it is audited as an intent
  // (TOGGLE_KITCHEN_PAUSE) rather than an anonymous column change, and so
  // it stamps kitchen_paused_at.
  const { data: current } = await supabase
    .from('tenant_settings')
    .select('is_kitchen_paused')
    .eq('tenant_id', staff.tenantId)
    .maybeSingle();

  if (current && current.is_kitchen_paused !== data.isKitchenPaused) {
    const { error: pauseError } = await supabase.rpc('set_kitchen_pause', {
      p_tenant_id: staff.tenantId,
      p_paused: data.isKitchenPaused,
      p_reason: data.isKitchenPaused ? 'Paused from store settings' : undefined,
    });
    if (pauseError) return fail(messageFor(pauseError.code, pauseError.message), { code: 'unknown' });
  }

  revalidatePath('/settings');
  return ok({ savedAt: new Date().toISOString() });
}

/** Publish only after the owner has completed the separately-audited menu and
 * branding steps. The database repeats every prerequisite under a row lock. */
export async function activateStorefront(): Promise<ActionResult<void>> {
  const staff = await resolveStaffTenantId();
  if (!staff || staff.role !== 'tenant_owner') {
    return fail('Only the restaurant owner can activate this storefront', { code: 'forbidden' });
  }

  const supabase = await createClientForRequest();
  const { error } = await supabase.rpc('activate_storefront', { p_tenant_id: staff.tenantId });
  if (error) return fail(messageFor(error.code, error.message), { code: 'unknown' });

  revalidatePath('/settings');
  return ok(undefined);
}
