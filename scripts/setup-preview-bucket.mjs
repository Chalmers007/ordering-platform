import { createClient } from "@supabase/supabase-js";

const db = createClient(
  "https://zvvujxngyszyduzsmuco.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dnVqeG5neXN6eWR1enNtdWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMzc4NTczMSwiZXhwIjoxODUxNTUxNzMxfQ.3hQC_mLPjBvNSc2gXEFz7K8Y6kTEGw0_4dqwUC3BQFU",
  { auth: { persistSession: false } }
);

try {
  // Create the preview-uploads bucket
  const { data, error } = await db.storage.createBucket('preview-uploads', {
    public: false,
    fileSizeLimit: 10485760, // 10MB
  });

  if (error) {
    if (error.message?.includes('already exists')) {
      console.log("✓ Bucket already exists");
    } else {
      throw error;
    }
  } else {
    console.log("✓ Bucket created: preview-uploads");
  }

  // Verify bucket exists
  const { data: buckets } = await db.storage.listBuckets();
  const exists = buckets?.some(b => b.name === 'preview-uploads');
  if (exists) {
    console.log("✓ Storage bucket ready for preview uploads");
  }
} catch (error) {
  console.log("Setup: " + (error?.message || "Check Supabase dashboard"));
}
