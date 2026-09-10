/** Live DB/storage tests require explicit opt-in; unit tests never load local secrets. */
export const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === '1';

if (databaseTestsEnabled) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= process.env.SUPABASE_URL;
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Database tests require ${missing.join(', ')}. Supply a local Supabase test environment; DATABASE_URL alone does not provide the Storage/REST API credentials.`);
  }
}
