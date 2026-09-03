'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChefHat, ExternalLink, Plug, Settings, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/cn';

const TABS = [
  { href: '/kds', label: 'Kitchen', icon: ChefHat },
  { href: '/menu', label: 'Menu Manager', icon: UtensilsCrossed },
  { href: '/settings', label: 'Store Settings', icon: Settings },
  { href: '/integrations', label: 'Integrations', icon: Plug },
] as const;

export function StaffNav({
  tenantName,
  storefrontSlug,
  impersonating,
}: {
  tenantName: string;
  storefrontSlug: string | null;
  impersonating: boolean;
}) {
  const pathname = usePathname();

  // The storefront lives on another host, so this cannot be a <Link> — it
  // is a full navigation to a different origin.
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  const storefrontUrl = storefrontSlug ? `${protocol}://${storefrontSlug}.${root}` : null;

  return (
    <header className="border-b border-neutral-800 bg-neutral-900">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-semibold text-neutral-100">{tenantName}</span>
          {impersonating ? (
            <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950">
              impersonated
            </span>
          ) : null}
        </div>

        <nav aria-label="Dashboard" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            const Icon = tab.icon;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-neutral-100 text-neutral-900'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {storefrontUrl ? (
          <a
            href={storefrontUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-100"
          >
            View storefront
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </header>
  );
}
