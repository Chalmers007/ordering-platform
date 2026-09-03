import { createClient } from "@supabase/supabase-js";

const db = createClient(
  "https://zvvujxngyszyduzsmuco.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU",
  { auth: { persistSession: false } }
);

try {
  const { data: sess, error: sessErr } = await db.from('preview_sessions').select('id').limit(1);
  if (sessErr) {
    console.log("preview_sessions: MISSING - " + sessErr.message);
  } else {
    console.log("✓ preview_sessions table exists");
  }
} catch (e) {
  console.log("preview_sessions: ERROR - " + e.message);
}

try {
  const { data: assets, error: assetErr } = await db.from('preview_session_assets').select('id').limit(1);
  if (assetErr) {
    console.log("preview_session_assets: MISSING - " + assetErr.message);
  } else {
    console.log("✓ preview_session_assets table exists");
  }
} catch (e) {
  console.log("preview_session_assets: ERROR - " + e.message);
}
