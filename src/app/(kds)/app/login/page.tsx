import { Suspense } from 'react';
import { Toaster } from 'sonner';
import { StaffLogin } from '@/components/auth/staff-login';

export const dynamic = 'force-dynamic';

export default function StaffLoginPage() {
  return (
    <>
      <Suspense>
        <StaffLogin
          title="Restaurant dashboard"
          subtitle="Sign in with the account your restaurant was set up with."
        />
      </Suspense>
      <Toaster position="top-center" richColors />
    </>
  );
}
