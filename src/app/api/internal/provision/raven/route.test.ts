import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bodyHash,
  signRequest,
  type RavenProvisionResponse,
} from '@/lib/integrations/raven-provision';

/**
 * Behavioural tests for the Raven provisioning endpoint.
 *
 * The signature helpers already had unit tests; the handler had none, which
 * is how three defects survived review — a request field with no column, a
 * retry rejected before the idempotency lookup that was supposed to answer
 * it, and a claim link on a host that cannot serve claims.
 *
 * Supabase and the parser are stubbed. No database, no network, no Raven
 * account: the point is the handler's decisions, not the storage engine.
 */

// ---------------------------------------------------------------------
// Fixtures — a fictional restaurant. Never use a real prospect here.
// ---------------------------------------------------------------------
const ROOT = 'order.example.test';
const SECRET = 'r'.repeat(48);
const KEY_ID = 'k-test';
const MENU = '<html><body><h1>Menu</h1><p>Gumbo $12.00</p></body></html>';

const PROSPECT = {
  version: '1',
  source_system: 'raven',
  raven_prospect_id: '11111111-1111-4111-8111-111111111111',
  idempotency_key: 'raven-event-00000001',
  event_type: 'restaurant.provision_requested',
  occurred_at: '2026-09-05T12:00:00Z',
  google_place_id: 'ChIJ_fictional_place_0001',
  normalized_business_name: 'Nowhere Noodle House',
  normalized_address: '404 Imaginary Ave, Testburg, ZZ',
  normalized_website: 'https://nowhere-noodle.example.test',
  phone: '+15555550100',
  email: 'owner@nowhere-noodle.example.test',
  restaurant_category: 'noodles',
  source_payload_hash: 'a'.repeat(64),
} as const;

const menuFields = (content = MENU, fetchedAt = new Date().toISOString()) => ({
  menu_source_url: 'https://nowhere-noodle.example.test/menu',
  menu_content: content,
  menu_content_type: 'text/html',
  menu_content_sha256: bodyHash(content),
  menu_fetched_at: fetchedAt,
});

// ---------------------------------------------------------------------
// Stub database
// ---------------------------------------------------------------------
type Row = Record<string, unknown>;

class FakeDb {
  rows: Row[] = [];
  nonces = new Set<string>();
  /** Simulates a concurrent winner committing between the read and insert. */
  forceInsertConflict = false;
  /** Runs at the moment the insert loses, to materialise that winner. */
  onInsertConflict: (() => void) | null = null;
  private seq = 0;

  private uniqueClash(candidate: Row): boolean {
    return this.rows.some(
      (r) =>
        r.idempotency_key === candidate.idempotency_key ||
        r.raven_prospect_id === candidate.raven_prospect_id ||
        (candidate.google_place_id != null && r.google_place_id === candidate.google_place_id) ||
        (r.normalized_business_name === candidate.normalized_business_name &&
          r.normalized_address === candidate.normalized_address),
    );
  }

  from(table: string) {
    if (table === 'raven_provision_nonces') {
      return {
        insert: (row: Row) => {
          const nonce = String(row.nonce);
          if (this.nonces.has(nonce)) return { error: { message: 'duplicate nonce' } };
          this.nonces.add(nonce);
          return { error: null };
        },
      };
    }

    const filters: [string, unknown][] = [];
    const matches = () => this.rows.filter((r) => filters.every(([c, v]) => r[c] === v));

    const selectBuilder = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return selectBuilder;
      },
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => ({ data: matches()[0] ?? null, error: null }),
    };

    return {
      select: () => selectBuilder,
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            if (this.forceInsertConflict || this.onInsertConflict || this.uniqueClash(row)) {
              const hook = this.onInsertConflict;
              this.onInsertConflict = null; // fires once, like a real race
              hook?.();
              return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
            }
            const stored = { ...row, id: `row-${++this.seq}` };
            this.rows.push(stored);
            return { data: stored, error: null };
          },
        }),
      }),
      update: (patch: Row) => ({
        eq: (column: string, value: unknown) => ({
          select: () => ({
            single: async () => {
              const target = this.rows.find((r) => r[column] === value);
              if (!target) return { data: null, error: { message: 'not found' } };
              Object.assign(target, patch);
              return { data: target, error: null };
            },
          }),
        }),
      }),
    };
  }
}

let db: FakeDb;
let stageCalls: { content: string; sourceUrl: string }[] = [];
let stageImpl: () => Promise<{ tenantId: string; slug: string; claimToken: string }>;

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }));

vi.mock('@/lib/scraper/parse-and-stage', () => {
  class StagingError extends Error {
    readonly reason: string;
    constructor(message: string, reason: string) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    StagingError,
    parseAndStage: async (input: { content: string; sourceUrl: string }) => {
      stageCalls.push({ content: input.content, sourceUrl: input.sourceUrl });
      return stageImpl();
    },
  };
});

// ---------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------
const PATH = '/api/internal/provision/raven';
let nonceSeq = 0;

async function post(body: Record<string, unknown>, overrides: Record<string, string> = {}) {
  const { POST } = await import('./route');
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `nonce-${++nonceSeq}`;
  const signature = signRequest(
    { source: 'raven', timestamp, nonce, keyId: KEY_ID, method: 'POST', path: PATH, body: raw },
    SECRET,
  );
  const headers = new Headers({
    'content-type': 'application/json',
    'x-vardr-source': 'raven',
    'x-vardr-timestamp': timestamp,
    'x-vardr-nonce': nonce,
    'x-vardr-key-id': KEY_ID,
    'x-vardr-signature': signature,
    ...overrides,
  });
  const request = new Request(`https://admin.${ROOT}${PATH}`, { method: 'POST', headers, body: raw });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await POST(request as any);
  return { status: response.status, body: (await response.json()) as RavenProvisionResponse & { error_code?: string } };
}

const TOUCHED = ['RAVEN_PROVISION_SECRET', 'RAVEN_PROVISION_KEY_ID', 'NEXT_PUBLIC_ROOT_DOMAIN'] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of TOUCHED) if (!saved.has(k)) saved.set(k, process.env[k]);
  process.env.RAVEN_PROVISION_SECRET = SECRET;
  process.env.RAVEN_PROVISION_KEY_ID = KEY_ID;
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = ROOT;
  db = new FakeDb();
  stageCalls = [];
  stageImpl = async () => ({ tenantId: 'tenant-1', slug: 'nowhere-noodle-house', claimToken: 'tok-abc' });
});

afterEach(() => {
  for (const k of TOUCHED) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ---------------------------------------------------------------------

describe('first provisioning', () => {
  it('stages the menu and stores the request', async () => {
    const { status, body } = await post({ ...PROSPECT, ...menuFields() });
    expect(status).toBe(200);
    expect(body.provisioning_status).toBe('succeeded');
    expect(body.ordering_tenant_id).toBe('tenant-1');
    expect(db.rows).toHaveLength(1);
  });

  it('parses from menu_source_url, not the marketing website', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    expect(stageCalls[0].sourceUrl).toBe('https://nowhere-noodle.example.test/menu');
    expect(stageCalls[0].content).toBe(MENU);
  });

  it('never persists the menu bytes, only their provenance', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    const stored = db.rows[0];
    expect(stored.menu_content).toBeUndefined();
    expect(stored.menu_content_sha256).toBe(bodyHash(MENU));
    expect(stored.menu_source_url).toBe('https://nowhere-noodle.example.test/menu');
  });

  it('does not write `version` — it is protocol metadata with no column', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    expect(db.rows[0]).not.toHaveProperty('version');
  });

  it('refuses a first request that carries no menu', async () => {
    const { status, body } = await post(PROSPECT);
    expect(status).toBe(422);
    expect(body.error_code).toBe('menu_required');
    expect(db.rows).toHaveLength(0);
  });
});

describe('idempotent retry', () => {
  it('returns the stored result WITHOUT menu bytes being resent', async () => {
    const first = await post({ ...PROSPECT, ...menuFields() });
    expect(first.body.provisioning_status).toBe('succeeded');

    const retry = await post(PROSPECT); // deliberately no menu fields
    expect(retry.status).toBe(200);
    expect(retry.body.error_code).toBeNull();
    expect(retry.body.ordering_tenant_id).toBe('tenant-1');
    expect(retry.body.request_id).toBe(first.body.request_id);
  });

  it('does not stage a second time or write a second row', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    await post(PROSPECT);
    expect(stageCalls).toHaveLength(1);
    expect(db.rows).toHaveLength(1);
  });

  it('still requires a fresh nonce — a replayed one is refused', async () => {
    const raw = JSON.stringify({ ...PROSPECT, ...menuFields() });
    const { POST } = await import('./route');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'replayed-nonce';
    const signature = signRequest(
      { source: 'raven', timestamp, nonce, keyId: KEY_ID, method: 'POST', path: PATH, body: raw },
      SECRET,
    );
    const make = () =>
      new Request(`https://admin.${ROOT}${PATH}`, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-vardr-source': 'raven',
          'x-vardr-timestamp': timestamp,
          'x-vardr-nonce': nonce,
          'x-vardr-key-id': KEY_ID,
          'x-vardr-signature': signature,
        }),
        body: raw,
      });
    /* eslint-disable @typescript-eslint/no-explicit-any */
    expect((await POST(make() as any)).status).toBe(200);
    const second = await POST(make() as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(second.status).toBe(409);
    expect((await second.json()).error_code).toBe('replayed_nonce');
  });
});

describe('exact duplicate — same prospect', () => {
  it('returns the stored result when the idempotency key repeats', async () => {
    const first = await post({ ...PROSPECT, ...menuFields() });
    const again = await post({ ...PROSPECT, ...menuFields() });
    expect(again.status).toBe(200);
    expect(again.body.request_id).toBe(first.body.request_id);
    expect(db.rows).toHaveLength(1);
  });

  it('returns the stored result for the same prospect under a NEW idempotency key', async () => {
    const first = await post({ ...PROSPECT, ...menuFields() });
    const again = await post({ ...PROSPECT, ...menuFields(), idempotency_key: 'raven-event-00000009' });
    expect(again.status).toBe(200);
    expect(again.body.request_id).toBe(first.body.request_id);
    expect(stageCalls).toHaveLength(1);
  });
});

describe('conflicting identity — a different prospect', () => {
  const OTHER_PROSPECT = {
    raven_prospect_id: '22222222-2222-4222-8222-222222222222',
    idempotency_key: 'raven-event-00000002',
  };

  it('refuses a different prospect claiming the same Google Place ID', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    const { status, body } = await post({
      ...PROSPECT,
      ...menuFields(),
      ...OTHER_PROSPECT,
      // Distinct name/address, so google_place_id is the only thing matching.
      normalized_business_name: 'Somewhere Soup Bar',
      normalized_address: '9 Other Rd, Testburg, ZZ',
    });
    expect(status).toBe(409);
    expect(body.error_code).toBe('duplicate_identity');
    expect(body.retryable).toBe(false);
    expect((body as { conflicting_field?: string }).conflicting_field).toBe('google_place_id');
  });

  it('refuses a different prospect claiming the same normalized name and address', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    const { status, body } = await post({
      ...PROSPECT,
      ...menuFields(),
      ...OTHER_PROSPECT,
      google_place_id: 'ChIJ_fictional_place_0002', // distinct, so identity is the only match
    });
    expect(status).toBe(409);
    expect((body as { conflicting_field?: string }).conflicting_field).toBe('normalized_identity');
  });

  it('refuses a different prospect reusing another prospect\'s idempotency key', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    const { status, body } = await post({
      ...PROSPECT,
      ...menuFields(),
      raven_prospect_id: OTHER_PROSPECT.raven_prospect_id,
      google_place_id: 'ChIJ_fictional_place_0003',
      normalized_business_name: 'Somewhere Soup Bar',
      normalized_address: '9 Other Rd, Testburg, ZZ',
    });
    expect(status).toBe(409);
    expect((body as { conflicting_field?: string }).conflicting_field).toBe('idempotency_key');
  });

  it('never mutates the stored row and never stages again', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    const before = JSON.parse(JSON.stringify(db.rows[0]));
    await post({ ...PROSPECT, ...menuFields(), ...OTHER_PROSPECT });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toEqual(before);
    expect(stageCalls).toHaveLength(1);
  });
});

describe('concurrent insert race', () => {
  it('returns the stored result when the race was lost to the SAME prospect', async () => {
    // The lookup misses, the insert loses, and the winner is this prospect's
    // own concurrent request — a retry, not a conflict.
    const winner = { ...PROSPECT, id: 'row-winner', provisioning_status: 'succeeded', tenant_id: 'tenant-1' };
    db.onInsertConflict = () => db.rows.push(winner as unknown as Record<string, unknown>);
    const { status, body } = await post({ ...PROSPECT, ...menuFields() });
    expect(status).toBe(200);
    expect(body.request_id).toBe('row-winner');
    expect(body.ordering_tenant_id).toBe('tenant-1');
  });

  it('reports a permanent conflict when the race was lost to a DIFFERENT prospect', async () => {
    const winner = {
      ...PROSPECT,
      id: 'row-winner',
      raven_prospect_id: '33333333-3333-4333-8333-333333333333',
      idempotency_key: 'raven-event-other',
      provisioning_status: 'succeeded',
    };
    db.onInsertConflict = () => db.rows.push(winner as unknown as Record<string, unknown>);
    const { status, body } = await post({ ...PROSPECT, ...menuFields() });
    expect(status).toBe(409);
    expect(body.error_code).toBe('duplicate_identity');
    expect(body.retryable).toBe(false);
  });

  it('reports a permanent conflict when the race left nothing findable', async () => {
    db.forceInsertConflict = true;
    const { status, body } = await post({ ...PROSPECT, ...menuFields() });
    expect(status).toBe(409);
    expect(body.error_code).toBe('duplicate_identity');
    expect(body.retryable).toBe(false);
    expect(stageCalls).toHaveLength(0);
  });
});

describe('claim url', () => {
  it("is on the restaurant's own storefront host, not the admin host", async () => {
    const { body } = await post({ ...PROSPECT, ...menuFields() });
    expect(body.claim_url).toBe(`https://nowhere-noodle-house.${ROOT}/claim?token=tok-abc`);
    expect(body.claim_url).not.toContain('admin.');
    expect(body.claim_url).not.toContain('/admin/');
  });
});

describe('oversized menu content', () => {
  it('is refused by the schema before any staging or storage', async () => {
    const huge = 'x'.repeat(500_001);
    const { status, body } = await post({ ...PROSPECT, ...menuFields(huge) });
    expect(status).toBe(400);
    expect(body.error_code).toBe('invalid_request');
    expect(stageCalls).toHaveLength(0);
    expect(db.rows).toHaveLength(0);
  });

  it('accepts content exactly at the limit', async () => {
    const atLimit = 'x'.repeat(500_000);
    const { status } = await post({ ...PROSPECT, ...menuFields(atLimit) });
    expect(status).toBe(200);
  });
});

describe('claim gating is preserved', () => {
  it('never marks a tenant active or a menu verified — it only records the claim link', async () => {
    await post({ ...PROSPECT, ...menuFields() });
    const stored = db.rows[0];
    expect(stored.provisioning_status).toBe('succeeded');
    expect(stored.claim_url).toContain('/claim?token=');
    // Nothing here may imply an orderable storefront.
    expect(stored).not.toHaveProperty('menu_verified_at');
    expect(stored).not.toHaveProperty('status');
    expect(stored.preview_id ?? null).toBeNull();
  });
});
