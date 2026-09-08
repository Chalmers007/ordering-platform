/**
 * POST /api/package-checkout
 *
 * Initiate checkout for a package purchase during claim flow.
 *
 * Supports multiple billing providers (Stripe, GHL, etc).
 *
 * Security:
 * - Verifies claim token server-side (never exposed in response)
 * - Uses opaque internal reference_id for payment binding
 * - Creates package_purchase record with 'pending' status
 * - Webhook confirmation changes status to 'confirmed'
 * - Browser redirect alone does NOT activate the restaurant
 * - Claim token is NOT passed to payment provider
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getBillingProvider } from '@/lib/payments/provider-factory';
import { cookies } from 'next/headers';
import { CLAIM_SESSION_COOKIE } from '@/lib/claims/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const schema = z.object({
  tenant_id: z.string().uuid(),
  package_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', issues: error.issues },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const service = createServiceClient();

  const token = (await cookies()).get(CLAIM_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'This link is not valid or has expired' }, { status: 410 });

  // ---- Verify claim token server-side ----
  const { data: claimable, error: verifyError } = await service.rpc('verify_claim_token', {
    p_token: token,
  });

  if (verifyError || !claimable?.[0]) {
    return NextResponse.json(
      { error: 'This link is not valid or has expired' },
      { status: 410 }
    );
  }

  const claimData = claimable[0] as { tenant_id: string };
  if (claimData.tenant_id !== body.tenant_id) {
    return NextResponse.json(
      { error: 'This link belongs to a different restaurant' },
      { status: 403 }
    );
  }

  // ---- Get package details ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkgResult = (await (service as any)
    .from('packages')
    .select('id, name, price_cents')
    .eq('id', body.package_id)
    .eq('is_active', true)
    .single()) as {
      data: { id: string; name: string; price_cents: number | null } | null;
      error: Record<string, unknown> | null;
    };

  if (pkgResult.error || !pkgResult.data) {
    return NextResponse.json(
      { error: 'Package not found' },
      { status: 404 }
    );
  }

  const pkg = pkgResult.data;

  // Get billing provider (defaults to Stripe, can be overridden via BILLING_PROVIDER env var)
  const provider = getBillingProvider();

  // Build completion and cancel URLs (will be filled with provider-specific params)
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const subdomain = body.tenant_id;

  // Stripe receives only the opaque purchase placeholder. The claim token
  // never enters Stripe URLs or metadata; the completion page resolves the
  // purchase server-side after Stripe confirms payment.
  const completionUrl = `${proto}://${subdomain}.${root}/demo-builder/claim/complete?purchase_id={PURCHASE_ID}&payment_confirmed=true`;
  const cancelUrl = `${proto}://${subdomain}.${root}/demo-builder/claim`;

  try {
    // Use opaque internal reference for payment binding (NOT claim_token)
    // This is used by the payment provider to bind the payment to the purchase record
    const internalReferenceId = pkg.name === 'Starter'
      ? `starter_free_${body.tenant_id}` // Free packages don't get a purchase_id
      : ''; // Paid packages: provider will create purchase_id

    const result = await provider.processCheckout({
      tenant_id: body.tenant_id,
      package_id: body.package_id,
      package_name: pkg.name,
      price_cents: pkg.price_cents,
      internal_reference_id: internalReferenceId,
      completion_url: completionUrl,
      cancel_url: cancelUrl,
    });

    if (result.type === 'confirmed') {
      // Free package confirmed immediately
      return NextResponse.json({
        redirect_url: result.redirect_url,
      });
    } else if (result.type === 'checkout_url') {
      // Stripe checkout
      return NextResponse.json({
        checkout_url: result.checkout_url,
        session_id: result.provider_reference_id,
      });
    } else if (result.type === 'payment_link_url') {
      // GHL payment link
      return NextResponse.json({
        payment_link_url: result.payment_link_url,
      });
    }

    return NextResponse.json(
      { error: 'Unexpected checkout response' },
      { status: 500 }
    );
  } catch (err) {
    console.error('Checkout error:', err);
    const message = err instanceof Error ? err.message : 'Payment processing unavailable';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
