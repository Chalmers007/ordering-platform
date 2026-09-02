import 'server-only';

import { cookies, headers } from 'next/headers';
import { IMPERSONATION_HEADER } from '@/lib/admin/impersonation';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export type Db = SupabaseClient<Database>;

/**
 * Request-scoped client carrying the caller's session.
 *
 * Every query it makes runs as that user, under RLS. This is the default —
 * reach for `createServiceClient()` only where the operation genuinely has
 * no user behind it.
 */
export async function createClientForRequest(): Promise<Db> {
  const cookieStore = await cookies();

  // Forward the impersonation header to PostgREST. fn_audit_log() reads
  // `request.headers` and sets audit_logs.impersonated from it, so without
  // this the trail would record a super admin's cross-tenant writes as
  // ordinary ones.
  const impersonatedTenant = (await headers()).get(IMPERSONATION_HEADER);

  return createServerClient<Database>(
    required('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
    {
      ...(impersonatedTenant
        ? { global: { headers: { [IMPERSONATION_HEADER]: impersonatedTenant } } }
        : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware already
            // refreshed the session, so this is safely ignorable here.
          }
        },
      },
    },
  );
}

/**
 * Bypasses RLS entirely.
 *
 * Legitimate uses in this slice are exactly two: the Stripe webhook (no user
 * session exists on an inbound webhook) and reading `tenant_secrets`, which
 * has RLS enabled with zero policies precisely so that nothing but this can
 * read it. Never construct one in response to a client-supplied tenant id
 * without checking that id first.
 */
export function createServiceClient(): Db {
  return createClient<Database>(
    required('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL),
    required('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-client-info': 'ordering-platform/service' } },
    },
  );
}
