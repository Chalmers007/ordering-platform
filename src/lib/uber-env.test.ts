import { afterEach, describe, expect, it } from 'vitest';
import {
  UBER_PRODUCTION_BASE,
  UBER_SANDBOX_BASE,
  UBER_PRODUCTION_AUTH,
  UBER_SANDBOX_AUTH,
  uberApiBase,
  uberApiBaseIsExplicit,
  uberAuthUrl,
  uberEnvironment,
} from './uber-env';

const original = process.env.UBER_DIRECT_API_BASE;

afterEach(() => {
  if (original === undefined) delete process.env.UBER_DIRECT_API_BASE;
  else process.env.UBER_DIRECT_API_BASE = original;
});

describe('uberApiBase', () => {
  it('defaults to sandbox when unset, so a forgotten variable cannot book a real courier', () => {
    delete process.env.UBER_DIRECT_API_BASE;
    expect(uberApiBase()).toBe(UBER_SANDBOX_BASE);
    expect(uberEnvironment()).toBe('sandbox');
    expect(uberApiBaseIsExplicit()).toBe(false);
  });

  it('treats an empty or whitespace value as unset rather than as a base URL', () => {
    process.env.UBER_DIRECT_API_BASE = '   ';
    expect(uberApiBase()).toBe(UBER_SANDBOX_BASE);
    expect(uberApiBaseIsExplicit()).toBe(false);
  });

  it('uses production only when it is asked for explicitly', () => {
    process.env.UBER_DIRECT_API_BASE = UBER_PRODUCTION_BASE;
    expect(uberApiBase()).toBe(UBER_PRODUCTION_BASE);
    expect(uberEnvironment()).toBe('production');
    expect(uberApiBaseIsExplicit()).toBe(true);
  });

  it('strips trailing slashes, which would otherwise produce a double slash in every path', () => {
    process.env.UBER_DIRECT_API_BASE = 'https://sandbox-api.uber.com//';
    expect(uberApiBase()).toBe(UBER_SANDBOX_BASE);
  });

  it('trims surrounding whitespace from a pasted value', () => {
    process.env.UBER_DIRECT_API_BASE = ` ${UBER_PRODUCTION_BASE}\n`;
    expect(uberApiBase()).toBe(UBER_PRODUCTION_BASE);
    expect(uberEnvironment()).toBe('production');
  });

  it('is read per call, so it never disagrees with itself mid-process', () => {
    process.env.UBER_DIRECT_API_BASE = UBER_SANDBOX_BASE;
    expect(uberEnvironment()).toBe('sandbox');
    process.env.UBER_DIRECT_API_BASE = UBER_PRODUCTION_BASE;
    expect(uberEnvironment()).toBe('production');
  });
});

describe('uberAuthUrl', () => {
  const originalAuth = process.env.UBER_DIRECT_AUTH_URL;
  afterEach(() => {
    if (originalAuth === undefined) delete process.env.UBER_DIRECT_AUTH_URL;
    else process.env.UBER_DIRECT_AUTH_URL = originalAuth;
  });

  it('uses the sandbox login host when the API base is sandbox', () => {
    delete process.env.UBER_DIRECT_AUTH_URL;
    process.env.UBER_DIRECT_API_BASE = UBER_SANDBOX_BASE;
    expect(uberAuthUrl()).toBe(UBER_SANDBOX_AUTH);
  });

  it('uses the production login host when the API base is production', () => {
    delete process.env.UBER_DIRECT_AUTH_URL;
    process.env.UBER_DIRECT_API_BASE = UBER_PRODUCTION_BASE;
    expect(uberAuthUrl()).toBe(UBER_PRODUCTION_AUTH);
  });

  it('cannot drift from the API base: an unset base means sandbox for both', () => {
    delete process.env.UBER_DIRECT_AUTH_URL;
    delete process.env.UBER_DIRECT_API_BASE;
    expect(uberEnvironment()).toBe('sandbox');
    expect(uberAuthUrl()).toBe(UBER_SANDBOX_AUTH);
  });

  it('honours an explicit override for an unforeseen host', () => {
    process.env.UBER_DIRECT_API_BASE = UBER_SANDBOX_BASE;
    process.env.UBER_DIRECT_AUTH_URL = 'https://auth.example.test/token';
    expect(uberAuthUrl()).toBe('https://auth.example.test/token');
  });
});
