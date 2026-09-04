import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATION = readFileSync('supabase/migrations/20260904000000_owner_activation_sequence.sql', 'utf8');
const CLAIM_FORM = readFileSync('src/components/claim/claim-form.tsx', 'utf8');
const ACTIONS = readFileSync('src/app/(kds)/app/(dashboard)/settings/actions.ts', 'utf8');
const SETTINGS = readFileSync('src/app/(kds)/app/(dashboard)/settings/page.tsx', 'utf8');
const CARD = readFileSync('src/components/dashboard/storefront-activation-card.tsx', 'utf8');

describe('owner activation sequence', () => {
  it('claiming grants ownership but leaves the storefront offline', () => {
    const claim = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.claim_tenant'), MIGRATION.indexOf('create or replace function public.activate_storefront'));
    expect(claim).toMatch(/set status = 'pending'/);
    expect(claim).not.toMatch(/set status = 'active'/);
    expect(CLAIM_FORM).toMatch(/stays offline until you confirm/);
  });

  it('activation is owner-only and enforces menu plus branding prerequisites', () => {
    expect(MIGRATION).toMatch(/role = 'tenant_owner'/);
    expect(MIGRATION).toMatch(/menu_verified_at is null/);
    expect(MIGRATION).toMatch(/logo_url is null or v_settings\.cover_image_url is null/);
    expect(MIGRATION).toMatch(/set status = 'active'/);
    expect(MIGRATION).toMatch(/grant execute on function public\.activate_storefront\(uuid\) to authenticated/);
  });

  it('derives the tenant from the owner session and exposes an explicit confirmation UI', () => {
    expect(ACTIONS).toMatch(/staff\.role !== 'tenant_owner'/);
    expect(ACTIONS).toMatch(/rpc\('activate_storefront', \{ p_tenant_id: staff\.tenantId \}\)/);
    expect(SETTINGS).toMatch(/<StorefrontActivationCard/);
    expect(CARD).toMatch(/Yes, activate storefront/);
    expect(CARD).toMatch(/Menu confirmed/);
    expect(CARD).toMatch(/Logo uploaded/);
    expect(CARD).toMatch(/Banner uploaded/);
  });
});
