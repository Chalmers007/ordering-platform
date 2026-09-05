import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetUberTokenCache, dispatchDelivery, cancelDelivery } from './uber';

/**
 * What actually goes on the wire.
 *
 * `uber-test-mode.test.ts` proves the FLAG reads correctly, which is not
 * the same claim as the request changing. This account has no working
 * sandbox host — sandbox-api.uber.com rejects its credentials outright —
 * so the only thing standing between a test order and a real courier at
 * a real address is `test_specifications` being present in the body.
 * That deserves an assertion on the body itself.
 *
 * The fetch is stubbed: no network call is made and no Uber account is
 * involved.
 */

/**
 * Only the three keys this file touches are saved and restored.
 *
 * Replacing `process.env` wholesale looked equivalent and was not: other
 * suites call `process.loadEnvFile('.env.local')` at module load, and
 * swapping the object back to a snapshot taken before they ran deleted
 * their configuration mid-run. That turned four import-time failures
 * into twenty-five timeouts.
 */
const TOUCHED = [
  'UBER_DIRECT_CLIENT_ID',
  'UBER_DIRECT_CLIENT_SECRET',
  'UBER_DIRECT_TEST_MODE',
] as const;
const saved = new Map<string, string | undefined>();
let requests: { url: string; init: RequestInit }[] = [];

function restoreEnv() {
  for (const key of TOUCHED) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function stubFetch(deliveryBody: unknown = { id: 'del_1', status: 'pending' }) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    requests.push({ url: href, init: init ?? {} });
    if (href.includes('/oauth/v2/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(deliveryBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const order = {
  pickup_name: 'Test Kitchen',
  pickup_address: '218 Fayetteville St, Raleigh, NC 27601',
  pickup_phone_number: '+19195550100',
  dropoff_name: 'Ada',
  dropoff_address: '1000 Wake Forest Rd, Raleigh, NC 27604',
  dropoff_phone_number: '+19195550111',
  manifest_items: [{ name: 'Margherita', quantity: 1, size: 'medium' as const }],
  manifest_total_value: 1400,
};

beforeEach(() => {
  requests = [];
  __resetUberTokenCache();
  for (const key of TOUCHED) if (!saved.has(key)) saved.set(key, process.env[key]);
  process.env.UBER_DIRECT_CLIENT_ID = 'test-client-id';
  process.env.UBER_DIRECT_CLIENT_SECRET = 'test-client-secret';
  delete process.env.UBER_DIRECT_TEST_MODE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetUberTokenCache();
  restoreEnv();
});

const lastDeliveryBody = () => {
  const call = requests.filter((r) => r.url.includes('/deliveries')).at(-1);
  return JSON.parse(String(call?.init.body ?? '{}'));
};

describe('dispatchDelivery payload', () => {
  it('carries the robo-courier specification when test mode is on by default', async () => {
    vi.stubGlobal('fetch', stubFetch());
    await dispatchDelivery('cus_1', order);
    expect(lastDeliveryBody().test_specifications).toEqual({
      robo_courier_specification: { mode: 'auto' },
    });
  });

  it('still carries it when the variable is set to anything but "false"', async () => {
    for (const value of ['true', '1', 'yes', '']) {
      requests = [];
      __resetUberTokenCache();
      process.env.UBER_DIRECT_TEST_MODE = value;
      vi.stubGlobal('fetch', stubFetch());
      await dispatchDelivery('cus_1', order);
      expect(
        lastDeliveryBody().test_specifications,
        `UBER_DIRECT_TEST_MODE=${JSON.stringify(value)} must still simulate`,
      ).toBeDefined();
    }
  });

  it('omits it ONLY on the exact string "false" — that is the going-live switch', async () => {
    process.env.UBER_DIRECT_TEST_MODE = 'false';
    vi.stubGlobal('fetch', stubFetch());
    await dispatchDelivery('cus_1', order);
    expect(lastDeliveryBody().test_specifications).toBeUndefined();
  });

  it('leaves the rest of the order untouched in either mode', async () => {
    vi.stubGlobal('fetch', stubFetch());
    await dispatchDelivery('cus_1', order);
    const simulated = lastDeliveryBody();

    requests = [];
    __resetUberTokenCache();
    process.env.UBER_DIRECT_TEST_MODE = 'false';
    vi.stubGlobal('fetch', stubFetch());
    await dispatchDelivery('cus_1', order);
    const live = lastDeliveryBody();

    delete simulated.test_specifications;
    expect(simulated).toEqual(live);
  });

  it('does not mutate the caller’s order object', async () => {
    vi.stubGlobal('fetch', stubFetch());
    const input = { ...order };
    await dispatchDelivery('cus_1', input);
    expect(input).not.toHaveProperty('test_specifications');
  });
});

describe('cancelDelivery URL', () => {
  it('requests a path, not a path with "POST " glued to the front', async () => {
    vi.stubGlobal('fetch', stubFetch({}));
    await cancelDelivery('cus_1', 'del_1');
    const call = requests.filter((r) => r.url.includes('/cancel')).at(-1);
    expect(call?.url).toContain('/v1/customers/cus_1/deliveries/del_1/cancel');
    expect(call?.url).not.toContain('POST');
    expect(call?.url).not.toContain(' ');
  });
});
