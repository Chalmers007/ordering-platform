import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { CLAIM_SESSION_COOKIE } from '@/lib/claims/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const next = request.nextUrl.searchParams.get('next') === '/claim' ? '/claim' : '/demo-builder/claim';
  if (!token) return NextResponse.redirect(new URL(next, request.url));

  const service = createServiceClient();
  const { data } = await service.rpc('verify_claim_token', { p_token: token });
  if (!data?.[0]) return NextResponse.redirect(new URL(next, request.url));

  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(CLAIM_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
