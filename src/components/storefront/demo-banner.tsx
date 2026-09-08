/**
 * Demo fallback banner for non-live storefronts.
 * Clearly marks preview-only demos.
 */

export interface DemoBannerProps {
  state?: string;
  isPreview?: boolean;
}

export function DemoBanner({ state = 'preview', isPreview = true }: DemoBannerProps) {
  if (!isPreview) return null;

  const stateLabels: Record<string, string> = {
    created: 'Demo — Initializing',
    awaiting_logo: 'Demo — Awaiting Logo',
    awaiting_menu: 'Demo — Awaiting Menu',
    preview_ready: 'Demo — Preview',
    claimed: 'Demo — Claimed',
    activated: 'Demo — Activated',
  };

  const message = stateLabels[state] || 'Demo — Not Yet Live';
  const bgColor = state === 'activated' ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200';
  const textColor = state === 'activated' ? 'text-blue-800' : 'text-yellow-800';

  return (
    <div className={`border-b-2 ${bgColor} px-4 py-3`}>
      <p className={`text-sm font-medium ${textColor} text-center`}>
        {state === 'activated' ? '✓ Live Storefront' : `⚠ ${message}`}
      </p>
    </div>
  );
}
