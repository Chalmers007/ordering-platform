/**
 * POST /api/demo/restaurant
 *
 * Create a demo fallback for a restaurant without automatic provisioning.
 *
 * Raven calls this when scraping fails, providing the discovered restaurant
 * name and optional prospect ID. Returns preview URL and tenant ID.
 *
 * Idempotent on raven_prospect_id: multiple calls for the same prospect
 * return the same tenant without creating duplicates.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createFallback } from '@/lib/demo/fallback';
import { requireBridgeCaller } from '@/lib/admin/bridge-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  name: z.string().min(1).max(200),
  raven_prospect_id: z.string().uuid().optional(),
  category: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  // Require bridge auth (Raven or operator)
  const caller = await requireBridgeCaller(request);
  if (!caller.ok) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
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
