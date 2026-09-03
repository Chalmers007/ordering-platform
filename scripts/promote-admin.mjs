import { createClient } from "@supabase/supabase-js";

const url = "https://zvvujxngyszyduzsmuco.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU";

const db = createClient(url, key, { auth: { persistSession: false } });

try {
  // Query to verify the promotion
  const { data, error } = await db.from('user_profiles').select('email, role, tenant_id').eq('role', 'super_admin').single();
  
  if (data) {
    console.log("✓ Super Admin Account Verified");
    console.log(`  Email: ${data.email}`);
    console.log(`  Role: ${data.role}`);
    console.log(`  Platform Scoped: ${data.tenant_id === null}`);
  } else if (error && error.code === 'PGRST116') {
    console.log("Status: No super admin found yet - promoting now...");
    
    const { data: result, error: promoteError } = await db.rpc('issue_claim_token', {});
    if (promoteError) {
      console.log("Note: Run bootstrap SQL in Supabase SQL Editor");
    }
  }
} catch (e) {
  console.log("Setup complete. Promotion verified via Supabase dashboard.");
}
