/**
 * Issues a one-time sign-in link for a staff account.
 *
 *   node --env-file=.env.local scripts/magic-link.ts <email> <origin> [next]
 *
 * Local development and support use only — it is the same link the auth
 * service would email, produced without needing SMTP configured.
 */
import { createClient } from '@supabase/supabase-js';

const [email, redirectTo] = process.argv.slice(2);
if (!email) {
  console.error('Usage: magic-link.ts <email> [redirectTo]');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });

if (error) {
  console.error(error.message);
  process.exit(1);
}

// Point at our own /auth/callback rather than the auth service's `verify`
// endpoint: verify redirects with the tokens in the URL *hash*, which never
// reaches the server, so the session is never established. The callback
// exchanges the hashed token server-side instead.
const origin = redirectTo ?? 'http://localhost:3000';
const next = process.argv[4] ?? '/';
console.log(
  `${origin}/auth/callback?token_hash=${data.properties.hashed_token}` +
    `&type=magiclink&next=${encodeURIComponent(next)}`,
);
