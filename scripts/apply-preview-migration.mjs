import { createClient } from "@supabase/supabase-js";

const db = createClient(
  "https://zvvujxngyszyduzsmuco.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU",
  { auth: { persistSession: false } }
);

const sql = `
set lock_timeout = '5s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preview-uploads', 'preview-uploads', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
`;

try {
  const { data, error } = await db.rpc('exec', { p_sql: sql });
  if (error) throw error;
  console.log("✓ Preview bucket configured");
} catch (e) {
  // Try direct approach
  try {
    // Create bucket via storage API
    await db.storage.createBucket('preview-uploads', {
      public: false,
      fileSizeLimit: 5242880,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    console.log("✓ Preview bucket created");
  } catch (e2) {
    console.log("Status: Bucket may already exist - " + (e2.message || ""));
  }
}
