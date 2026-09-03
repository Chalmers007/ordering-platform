/**
 * Post-deployment smoke test.
 *
 *   node scripts/smoke-test.ts                      # http://localhost:3000
 *   node scripts/smoke-test.ts platform.com         # https://platform.com
 *   node scripts/smoke-test.ts platform.com --tenant=joespizza
 *
 * (`npx tsx scripts/smoke-test.ts ...` works too; Node 22+ runs the file
 * directly without it.)
 *
 * Checks each route against the status it is SUPPOSED to return, not
 * merely "is it 2xx". That distinction is the point of the script:
 *
 *   * the apex REDIRECTS to the admin console — a 200 there means the
 *     redirect broke;
 *   * /api/admin/webhooks/drain must REFUSE an unauthenticated caller —
 *     a 200 there is a security hole, not a healthy endpoint;
 *   * an unknown subdomain must NOT resolve to somebody's storefront.
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */

type Expectation = {
  name: string;
  url: string;
  method?: 'GET' | 'POST';
  /** Status codes that mean "working as designed". */
  expect: number[];
  /** Extra assertion on the body, when status alone is not enough. */
  assertBody?: (body: string) => string | null;
  /** Skipped checks are reported, never silently dropped. */
  skip?: string;
};

type Result = {
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  detail: string;
};

const args = process.argv.slice(2);
const rootArg = args.find((a) => !a.startsWith('--')) ?? 'localhost:3000';
const tenant = args.find((a) => a.startsWith('--tenant='))?.split('=')[1];

const root = rootArg.replace(/^https?:\/\//, '').replace(/\/$/, '');
const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(root);
const protocol = isLocal ? 'http' : 'https';
const port = root.match(/:(\d+)$/)?.[1];
const bareRoot = root.replace(/:\d+$/, '');
const withPort = (host: string) => `${protocol}://${host}${port ? `:${port}` : ''}`;

/** A subdomain no tenant could plausibly own. */
const UNKNOWN_SUBDOMAIN = 'definitely-not-a-tenant-9f3a2b';

const checks: Expectation[] = [
  {
    name: 'Apex redirects to the admin console',
    url: withPort(bareRoot) + '/',
    // The apex is not a marketing page; src/app/page.tsx redirects to
    // admin.<root>. A 200 would mean that redirect stopped working.
    expect: [301, 302, 307, 308],
  },
  {
    name: 'Health endpoint reports the database up',
    url: withPort(bareRoot) + '/api/health',
    expect: [200],
    assertBody: (body) => {
      try {
        const parsed = JSON.parse(body) as { ok?: boolean; database?: string };
        return parsed.ok === true && parsed.database === 'up'
          ? null
          : `database reported "${parsed.database}"`;
      } catch {
        return 'response was not JSON';
      }
    },
  },
  {
    name: 'Super-admin login page renders',
    url: withPort(`admin.${bareRoot}`) + '/login',
    expect: [200],
    assertBody: (body) =>
      /Platform console/i.test(body) ? null : 'login form not found in the response',
  },
  {
    name: 'Super-admin console is gated when signed out',
    url: withPort(`admin.${bareRoot}`) + '/',
    // Middleware must bounce an anonymous visitor to /login. A 200 here
    // would mean the console rendered without a session.
    expect: [301, 302, 307, 308],
  },
  {
    name: 'Staff dashboard login page renders',
    url: withPort(`app.${bareRoot}`) + '/login',
    expect: [200],
    assertBody: (body) =>
      /Restaurant dashboard/i.test(body) ? null : 'login form not found in the response',
  },
  {
    name: 'Webhook outbox drain refuses anonymous callers',
    url: withPort(bareRoot) + '/api/admin/webhooks/drain',
    method: 'POST',
    // 401/403 is the PASS. A 200 would mean anyone on the internet can
    // drive the platform's outbound webhook queue.
    expect: [401, 403],
  },
  {
    name: 'Unknown subdomain does not resolve to a storefront',
    url: withPort(`${UNKNOWN_SUBDOMAIN}.${bareRoot}`) + '/',
    expect: [200, 404],
    assertBody: (body) =>
      /No restaurant here yet|not connected to a restaurant/i.test(body)
        ? null
        : 'an unknown host returned something other than the unavailable page',
  },
  {
    name: tenant ? `Storefront renders for "${tenant}"` : 'Storefront check',
    url: withPort(`${tenant ?? 'tenant'}.${bareRoot}`) + '/',
    expect: [200],
    skip: tenant ? undefined : 'pass --tenant=<slug> to check a live storefront',
  },
];

/**
 * Local subdomains need a hand.
 *
 * Browsers resolve *.localhost to 127.0.0.1 (RFC 6761); Node's resolver
 * does not, so `fetch('http://admin.localhost:3000')` fails outright. The
 * obvious workaround — fetch 127.0.0.1 with a Host header — does not work
 * either: `Host` is a forbidden header name, and fetch drops it silently,
 * so the request lands on the apex and the check passes against the wrong
 * page. That silent wrong-route is worse than an error.
 *
 * So against localhost only, go one level down to node:http, where the
 * Host header is ours to set. Remote targets use fetch, where real DNS
 * does the job.
 */
async function requestViaHostHeader(
  url: string,
  method: string,
): Promise<{ status: number; body: string }> {
  const { request } = await import('node:http');
  const target = new URL(url);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: target.port || 80,
        path: target.pathname + target.search,
        method,
        headers: {
          host: target.host,
          'user-agent': 'ordering-platform-smoke-test',
        },
        timeout: 15_000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );

    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function run(check: Expectation): Promise<Result> {
  const startedAt = performance.now();
  const method = check.method ?? 'GET';

  try {
    let status: number;
    let readBody: () => Promise<string>;

    if (isLocal) {
      const result = await requestViaHostHeader(check.url, method);
      status = result.status;
      readBody = async () => result.body;
    } else {
      const response = await fetch(check.url, {
        method,
        // Observe redirects instead of following them: the redirect IS the
        // behaviour under test for the apex and the gated console.
        redirect: 'manual',
        headers: { 'user-agent': 'ordering-platform-smoke-test' },
        signal: AbortSignal.timeout(15_000),
      });
      status = response.status;
      readBody = () => response.text();
    }

    const ms = Math.round(performance.now() - startedAt);
    const statusOk = check.expect.includes(status);

    let detail = `expected ${check.expect.join('/')}`;
    if (statusOk && check.assertBody) {
      const problem = check.assertBody(await readBody());
      if (problem) {
        return { name: check.name, url: check.url, ok: false, status, ms, detail: problem };
      }
      detail = 'status and body as expected';
    } else if (statusOk) {
      detail = 'status as expected';
    }

    return { name: check.name, url: check.url, ok: statusOk, status, ms, detail };
  } catch (error) {
    return {
      name: check.name,
      url: check.url,
      ok: false,
      status: null,
      ms: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : 'request failed',
    };
  }
}

async function main(): Promise<void> {
  console.log(`\nSmoke test against ${protocol}://${root}`);
  if (!tenant) console.log('(no --tenant=<slug> given; the storefront check will be skipped)');
  console.log('');

  const results: Result[] = [];
  const skipped: Expectation[] = [];

  // Sequential on purpose: a cold serverless deployment reports wildly
  // misleading latency if eight requests race the same cold start.
  for (const check of checks) {
    if (check.skip) {
      skipped.push(check);
      continue;
    }
    const result = await run(check);
    results.push(result);

    const tag = result.ok ? '[PASS]' : '[FAIL]';
    const status = result.status ?? '---';
    console.log(
      `${tag} ${String(status).padEnd(3)} ${String(result.ms).padStart(5)}ms  ${result.name}`,
    );
    if (!result.ok) {
      console.log(`         ${result.url}`);
      console.log(`         ${result.detail}`);
    }
  }

  for (const check of skipped) {
    console.log(`[SKIP]  --  ${'    -'}ms  ${check.name}`);
    console.log(`         ${check.skip}`);
  }

  const failed = results.filter((r) => !r.ok);
  const slowest = results.reduce((max, r) => Math.max(max, r.ms), 0);

  console.log('');
  console.log(
    `${results.length - failed.length}/${results.length} passed` +
      `${skipped.length ? `, ${skipped.length} skipped` : ''}` +
      ` · slowest ${slowest}ms`,
  );

  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.map((f) => f.name).join('; ')}`);
    process.exit(1);
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error(`Smoke test could not run: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
