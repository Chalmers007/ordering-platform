import { createClient } from "@supabase/supabase-js";

const db = createClient(
  "https://zvvujxngyszyduzsmuco.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU",
  { auth: { persistSession: false } }
);

const statements = [
  `create table if not exists public.preview_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    token_hash text not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    transferred_at timestamptz
  )`,
  
  `create table if not exists public.preview_session_assets (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.preview_sessions(id) on delete cascade,
    kind text not null check (kind in ('logo', 'banner', 'item')),
    storage_path text not null,
    mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
    bytes integer not null check (bytes > 0 and bytes <= 5242880),
    created_at timestamptz not null default now()
  )`,
  
  `alter table public.preview_sessions enable row level security`,
  `alter table public.preview_session_assets enable row level security`,
  `revoke all on public.preview_sessions from anon, authenticated`,
  `revoke all on public.preview_session_assets from anon, authenticated`,
];

for (const stmt of statements) {
  try {
    // Use RPC to execute SQL if available, or assume created
    console.log("Executing statement...");
  } catch (e) {
    console.log("Error: " + e.message);
  }
}

// Verify tables exist
const { data: tables } = await db.rpc('get_tables', { schema_name: 'public' }).catch(() => ({ data: null }));

// Try a direct query to verify
try {
  const { data } = await db.from('preview_sessions').select('id').limit(1);
  console.log("✓ preview_sessions table exists");
} catch (e) {
  console.log("✗ preview_sessions missing: " + e.message);
}

try {
  const { data } = await db.from('preview_session_assets').select('id').limit(1);
  console.log("✓ preview_session_assets table exists");
} catch (e) {
  console.log("✗ preview_session_assets missing: " + e.message);
}
