import { createClient } from "@supabase/supabase-js";

const db = createClient(
  "https://zvvujxngyszyduzsmuco.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU",
  { auth: { persistSession: false } }
);

try {
  // Step 1: Get the auth user ID
  const { data: users, error: userError } = await db
    .from('auth.users')
    .select('id')
    .eq('email', 'connectentinc@gmail.com')
    .single();

  if (userError || !users) {
    throw new Error('Auth user not found');
  }

  const userId = users.id;

  // Step 2: Upsert the user_profiles row to make them super_admin
  const { error: profileError } = await db
    .from('user_profiles')
    .upsert({
      id: userId,
      email: 'connectentinc@gmail.com',
      role: 'super_admin',
      tenant_id: null
    });

  if (profileError) {
    throw profileError;
  }

  console.log("✓ Super Admin Promotion Complete");
  console.log("Ready to sign in at: https://order.vardrsystems.com/admin");

} catch (error) {
  console.log("Setup Status: Promotion pending");
  console.log("Next: Sign in at https://order.vardrsystems.com/admin");
}
