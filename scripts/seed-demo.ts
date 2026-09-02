/**
 * Demo seeder.
 *
 *   npm run seed:demo
 *
 * Complements supabase/seed.sql, which `db reset` applies automatically.
 * This half does the two things SQL cannot:
 *
 *   1. auth users with real passwords, via the admin API — which also makes
 *      this the seeder that works against a REMOTE project, where there is
 *      no psql;
 *   2. actual objects in Supabase Storage, so `menu_items.image_path`
 *      points at files that exist rather than at a plausible-looking path.
 *
 * Idempotent: re-running updates rather than duplicating.
 */

import { createClient } from '@supabase/supabase-js';
import { deflateSync } from 'node:zlib';
import type { Database } from '../src/types/database.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (try: npm run seed:demo).',
  );
  process.exit(1);
}

const TENANT_ID = '0a11ce00-0000-4000-8000-000000000001';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass!2026';

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------
// A tiny PNG encoder.
//
// Placeholder art still has to be a real file: the bucket rejects anything
// that is not a listed image type, and a broken image in the demo is worse
// than none. Writing 30 lines of PNG beats adding an image dependency.
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A soft two-tone square, so the demo menu does not look like broken images. */
function makePng(size: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let offset = 0;

  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const t = (x / size) * 0.35 + (y / size) * 0.65;
      raw[offset] = Math.round(from[0] + (to[0] - from[0]) * t);
      raw[offset + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      raw[offset + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10..12 default to 0: deflate, adaptive filtering, no interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------

type SeedUser = {
  email: string;
  role: 'super_admin' | 'tenant_owner' | 'tenant_staff';
  fullName: string;
  tenantId: string | null;
};

const USERS: SeedUser[] = [
  // A super admin is platform-scoped and must never carry a tenant_id --
  // the user_profiles constraint enforces it.
  { email: 'admin@platform.test', role: 'super_admin', fullName: 'Platform Admin', tenantId: null },
  { email: 'joe@joespizza.test', role: 'tenant_owner', fullName: 'Joe Marino', tenantId: TENANT_ID },
  { email: 'kitchen@joespizza.test', role: 'tenant_staff', fullName: 'Kitchen Station', tenantId: TENANT_ID },
];

/**
 * Find an existing demo user.
 *
 * Deliberately not `auth.admin.listUsers()`: that endpoint scans every
 * auth.users row into Go strings and 500s on a NULL token column, which is
 * exactly what a raw SQL fixture leaves behind. `public.user_profiles` is
 * populated by the signup trigger, mirrors the id, and is a normal table.
 */
async function findUserByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (error) throw new Error(`Could not look up ${email}: ${error.message}`);
  return data?.id ?? null;
}

async function seedUsers(): Promise<void> {
  console.log('\nUsers');
  for (const user of USERS) {
    let id = await findUserByEmail(user.email);

    if (id) {
      const { error } = await supabase.auth.admin.updateUserById(id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error) throw new Error(`Could not reset ${user.email}: ${error.message}`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: user.fullName },
      });

      if (error || !data.user) {
        // The account may exist without a profile row (a fixture inserted
        // it directly). Fall back to the id the error is about.
        const existing = await findUserByEmail(user.email);
        if (!existing) throw new Error(`Could not create ${user.email}: ${error?.message}`);
        id = existing;
        const { error: resetError } = await supabase.auth.admin.updateUserById(id, {
          password: DEMO_PASSWORD,
          email_confirm: true,
        });
        if (resetError) throw new Error(`Could not reset ${user.email}: ${resetError.message}`);
      } else {
        id = data.user.id;
      }
    }

    // The signup trigger deliberately refuses client-supplied privileged
    // roles, so the role is set here, service-side.
    const { error: profileError } = await supabase
      .from('user_profiles')
      .update({
        role: user.role,
        tenant_id: user.tenantId,
        full_name: user.fullName,
        email: user.email,
      })
      .eq('id', id);

    if (profileError) throw new Error(`Could not set role for ${user.email}: ${profileError.message}`);
    console.log(`  ${user.role.padEnd(13)} ${user.email.padEnd(26)} ${id}`);
  }
}

const IMAGES: { itemId: string; from: [number, number, number]; to: [number, number, number] }[] = [
  { itemId: '0a11ce00-0004-4000-8000-000000000001', from: [244, 214, 160], to: [201, 88, 61] },
  { itemId: '0a11ce00-0004-4000-8000-000000000002', from: [232, 168, 140], to: [150, 40, 38] },
  { itemId: '0a11ce00-0004-4000-8000-000000000003', from: [250, 236, 200], to: [206, 168, 96] },
  { itemId: '0a11ce00-0004-4000-8000-000000000004', from: [238, 216, 170], to: [176, 126, 66] },
  { itemId: '0a11ce00-0004-4000-8000-000000000005', from: [214, 232, 190], to: [94, 140, 74] },
  { itemId: '0a11ce00-0004-4000-8000-000000000006', from: [246, 246, 240], to: [206, 214, 208] },
  { itemId: '0a11ce00-0004-4000-8000-000000000007', from: [206, 226, 240], to: [86, 136, 178] },
  { itemId: '0a11ce00-0004-4000-8000-000000000008', from: [246, 206, 214], to: [198, 84, 110] },
];

async function seedImages(): Promise<void> {
  console.log('\nMenu images');
  for (const image of IMAGES) {
    // The storage policies key isolation off the first path segment being
    // the tenant id, so the path shape is load-bearing, not cosmetic.
    const path = `${TENANT_ID}/menu-items/${image.itemId}.png`;
    const png = makePng(320, image.from, image.to);

    const { error: uploadError } = await supabase.storage
      .from('menu-images')
      .upload(path, png, { contentType: 'image/png', upsert: true });

    if (uploadError) throw new Error(`Could not upload ${path}: ${uploadError.message}`);

    const { error: linkError } = await supabase
      .from('menu_items')
      .update({ image_path: path })
      .eq('id', image.itemId);

    if (linkError) throw new Error(`Could not link ${path}: ${linkError.message}`);
    console.log(`  ${(png.length / 1024).toFixed(1).padStart(6)} KB  ${path}`);
  }
}

async function verify(): Promise<void> {
  const [{ count: items }, { count: withImages }, { data: settings }, { data: objects }] =
    await Promise.all([
      supabase.from('menu_items').select('*', { count: 'exact', head: true }).eq('tenant_id', TENANT_ID),
      supabase
        .from('menu_items')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', TENANT_ID)
        .not('image_path', 'is', null),
      supabase.from('tenant_settings').select('*').eq('tenant_id', TENANT_ID).single(),
      supabase.storage.from('menu-images').list(`${TENANT_ID}/menu-items`),
    ]);

  console.log('\nVerification');
  console.log(`  menu items                 ${items}`);
  console.log(`  items with a linked image  ${withImages}`);
  console.log(`  objects in storage         ${objects?.length ?? 0}`);
  console.log(`  tech_fee_enabled           ${settings?.tech_fee_enabled}`);
  console.log(`  tech_fee_cents             ${settings?.tech_fee_cents}`);
  console.log(`  estimated_prep_time_mins   ${settings?.estimated_prep_time_mins}`);

  if (withImages !== items) throw new Error('Some menu items have no image linked');
  if (!settings?.tech_fee_enabled || settings.tech_fee_cents !== 100) {
    throw new Error('The demo tenant is not configured with the $1.00 platform fee');
  }
}

async function main(): Promise<void> {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, slug, name, status')
    .eq('id', TENANT_ID)
    .maybeSingle();

  if (error) throw new Error(`Could not reach Supabase: ${error.message}`);
  if (!tenant) {
    throw new Error(
      'The demo tenant does not exist. Run `npm run db:reset` first (it applies supabase/seed.sql).',
    );
  }

  console.log(`Seeding demo data for ${tenant.name} (${tenant.slug}, ${tenant.status})`);
  await seedUsers();
  await seedImages();
  await verify();

  console.log(`\nSign in with password: ${DEMO_PASSWORD}`);
  console.log('Done.\n');
}

main().catch((error: unknown) => {
  console.error(`\nSeeding failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
