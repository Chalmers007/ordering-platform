'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Always visible while impersonation is active.
 *
 * Sticky and high-contrast on purpose: an administrator who forgets they are
 * viewing someone else's restaurant is how cross-tenant mistakes happen. The
 * exit is one tap, never buried in a menu.
 */
export function ImpersonationBanner({
  tenantName,
  startedAt,
}: {
  tenantName: string;
  startedAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    const response = await fetch('/api/admin/impersonate', { method: 'DELETE' });
    setBusy(false);

    if (!response.ok) {
      toast.error('Could not exit impersonation');
      return;
    }

    // On app.<root> a refresh would re-render a staff page the administrator
    // has no tenant for. Send them back to the console they came from.
    const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '';
    if (root && window.location.hostname === `app.${root.replace(/:\d+$/, '')}`) {
      window.location.assign(`${window.location.protocol}//admin.${root}`);
      return;
    }
    router.refresh();
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 border-b-2 border-amber-600 bg-amber-400 text-amber-950"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-6 py-2.5">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
        <p className="flex-1 text-sm font-semibold">
          Viewing as Super Admin (Target: {tenantName}). Actions are logged.
          <span suppressHydrationWarning className="ml-2 font-normal opacity-80">
            Since {new Date(startedAt).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </p>
        <Button
          size="sm"
          loading={busy}
          onClick={exit}
          className="bg-amber-950 text-amber-50 hover:bg-amber-900"
        >
          Exit impersonation
        </Button>
      </div>
    </div>
  );
}
