import { createClient } from "@supabase/supabase-js";

const db = createClient(
  "https://zvvujxngyszyduzsmuco.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU",
  { auth: { persistSession: false } }
);

const { data, error } = await db.rpc('is_super_admin');
console.log(data !== null && data !== false ? "Super Admin Found" : "Not Yet Promoted");

const { data: profiles } = await db.from('user_profiles').select('email, role').eq('role', 'super_admin');
if (profiles?.length) {
  console.log("Account: " + profiles[0].email + " (super_admin)");
} else {
  console.log("Status: Awaiting promotion via bootstrap SQL");
}
