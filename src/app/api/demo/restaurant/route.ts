/**
 * POST /api/demo/restaurant
 *
 * Create a demo fallback for a restaurant without automatic provisioning.
 *
 * Raven calls this when provisioning fails, providing the discovered restaurant
 * name and optional prospect ID. Validates HMAC signature (Raven server-to-server).
 * Returns preview URL and tenant ID. Idempotent on raven_prospect_id.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createFallback } from '@/lib/demo/fallback';
import { parseKeyRing, signaturesEqual, REPLAY_WINDOW_SECONDS } from '@/lib/integrations/raven-provision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  name: z.string().min(1).max(200),
  raven_prospect_id: z.string().uuid().optional(),
  category: z.string().max(120).optional(),
});

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ error: code, error_message: message }, { status });
}

export async function POST(request: NextRequest) {
  // Validate HMAC signature (Raven server-to-server authentication)
  const source = request.headers.get('x-vardr-source');
  const timestamp = request.headers.get('x-vardr-timestamp');
  const nonce = request.headers.get('x-vardr-nonce');
  const keyId = request.headers.get('x-vardr-key-id');
  const signature = request.headers.get('x-vardr-signature');

  if (!source || !timestamp || !nonce || !keyId || !signature) {
    return fail('missing_auth', 'signed headers are required', 401);
  }

  if (source !== 'raven') {
    return fail('wrong_source', 'invalid source identity', 403);
  }

  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > REPLAY_WINDOW_SECONDS) {
    return fail('stale_timestamp', 'request timestamp is outside the replay window', 401);
  }

  const raw = await request.text();
  const secret = parseKeyRing().get(keyId);
  if (!secret) {
    return fail('unknown_key', 'unknown signing key', 401);
  }

  const expected = (await import('@/lib/integrations/raven-provision')).signRequest(
    { source, timestamp, nonce, keyId, method: 'POST', path: new URL(request.url).pathname, body: raw },
    secret
  );

  if (!signaturesEqual(signature, expected)) {
    return fail('invalid_signature', 'signature verification failed', 401);
  }

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Invalid JSON body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await createFallback({
      name: body.name,
      raven_prospect_id: body.raven_prospect_id,
      category: body.category,
    });

    return NextResponse.json(
      {
        tenant_id: result.tenant_id,
        slug: result.slug,
        preview_url: result.preview_url,
        state: result.state,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create demo fallback';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
