/**
 * Alias of the canonical Uber Direct webhook at `/api/webhooks/uber`.
 *
 * This path previously carried a SECOND, independent handler that read
 * `UBER_WEBHOOK_SECRET` — an environment variable that does not exist
 * (the real one is `UBER_DIRECT_WEBHOOK_SECRET`). With the secret always
 * undefined it took the "don't fail on a missing secret" branch and
 * answered every request `200 {ok:true}` without verifying the signature
 * and without applying the status, so a delivery registered against this
 * URL would have had every update silently discarded while Uber saw a
 * success and never retried.
 *
 * It is kept as an alias rather than deleted because the URL may already
 * be registered with Uber; both paths now run the same verified,
 * idempotent handler.
 */
// `runtime` and `dynamic` are re-declared rather than re-exported: Next
// parses route segment config statically and rejects a re-export.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { POST } from '../route';
