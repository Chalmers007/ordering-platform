import { Suspense } from 'react';
import { Toaster } from 'sonner';
import { StaffLogin } from '@/components/auth/staff-login';

export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  return (
    <>
      {/* useSearchParams needs a Suspense boundary to avoid opting the
          whole route out of static optimisation. */}
      <Suspense>
        <StaffLogin
          title="Platform console"
          subtitle="Sign in with your platform administrator account."
        />
      </Suspense>
      <Toaster position="top-center" richColors />
    </>
  );
}
