import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { getUberAccessToken } from '@/lib/uber';
import { uberEnvironment } from '@/lib/uber-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Test Uber OAuth and retrieve environment info.
 * Super Admin access required.
 * Returns only: OAuth success/failure and environment (sandbox/prod).
 */
export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === 'unauthenticated' ? 'Not signed in' : 'Forbidden' },
      { status: guard.reason === 'unauthenticated' ? 401 : 403 },
    );
  }

  try {
    const token = await getUberAccessToken();
    return NextResponse.json(
      {
        success: true,
        environment: uberEnvironment(),
        hasToken: !!token,
        message: 'OAuth successful',
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return NextResponse.json(
      {
        success: false,
        environment: uberEnvironment(),
        error: message,
      },
      { status: 200 },
    );
  }
}
