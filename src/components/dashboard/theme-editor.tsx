'use client';

import { BRAND_DEFAULTS, safeFontFamily, safeHexColor } from '@/lib/storefront/brand';
import { Input } from '@/components/ui/input';

const FONTS = ['Inter', 'Georgia', 'Helvetica', 'Verdana', 'Courier New', 'Trebuchet MS'];

export type Theme = {
  primary: string;
  accent: string;
  background: string;
  font: string;
  logoUrl: string;
  bannerUrl: string;
};

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-300">{label}</span>
      <span className="flex gap-2">
        {/* Native picker plus a text field: the picker is faster, but a
            brand guideline gives you a hex code to paste. */}
        <input
          type="color"
          aria-label={`${label} colour picker`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-neutral-700 bg-neutral-950 disabled:opacity-50"
          value={safeHexColor(value, '#000000')}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          className="border-neutral-700 bg-neutral-950 font-mono text-neutral-100"
          value={value}
          disabled={disabled}
          aria-label={`${label} hex value`}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

/**
 * Theme editor with a live preview.
 *
 * The preview is rendered from the same tokens the storefront uses, so what
 * it shows is what ships — rather than a mock that drifts from the real
 * page the moment either changes.
 */
export function ThemeEditor({
  theme,
  onChange,
  storefrontName,
  disabled,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
  storefrontName: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<Theme>) => onChange({ ...theme, ...patch });

  const primary = safeHexColor(theme.primary, BRAND_DEFAULTS.primary);
  const accent = safeHexColor(theme.accent, BRAND_DEFAULTS.accent);
  const background = safeHexColor(theme.background, BRAND_DEFAULTS.background);
  const font = safeFontFamily(theme.font, BRAND_DEFAULTS.font);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorField label="Primary" value={theme.primary} disabled={disabled} onChange={(v) => set({ primary: v })} />
          <ColorField label="Accent" value={theme.accent} disabled={disabled} onChange={(v) => set({ accent: v })} />
          <ColorField label="Background" value={theme.background} disabled={disabled} onChange={(v) => set({ background: v })} />
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-300">Typeface</span>
          <select
            className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 disabled:opacity-50"
            value={theme.font}
            disabled={disabled}
            onChange={(event) => set({ font: event.target.value })}
          >
            {FONTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-300">Logo URL</span>
          <Input
            className="border-neutral-700 bg-neutral-950 text-neutral-100"
            value={theme.logoUrl}
            disabled={disabled}
            placeholder="https://…"
            onChange={(event) => set({ logoUrl: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-300">Hero banner URL</span>
          <Input
            className="border-neutral-700 bg-neutral-950 text-neutral-100"
            value={theme.bannerUrl}
            disabled={disabled}
            placeholder="https://…"
            onChange={(event) => set({ bannerUrl: event.target.value })}
          />
        </label>

        <p className="text-xs text-neutral-500">
          Colours must be hex. The database rejects anything else, because these values are
          written into a stylesheet on your storefront.
        </p>
      </div>

      {/* ---- live preview ---- */}
      <div>
        <p className="mb-2 text-sm font-medium text-neutral-300">Live preview</p>
        <div
          className="overflow-hidden rounded-xl border border-neutral-700"
          style={{ background, fontFamily: `"${font}", ui-sans-serif, system-ui, sans-serif` }}
        >
          <div className="relative h-20 w-full overflow-hidden bg-neutral-800">
            {theme.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.bannerUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
            <div className="absolute inset-0 bg-black/50" />
          </div>

          <div className="flex flex-col items-center px-3 pb-3 text-center">
            <div className="-mt-6 h-12 w-12 overflow-hidden rounded-full border-4 border-white bg-white shadow">
              {theme.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={theme.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span
                  className="flex h-full w-full items-center justify-center text-sm font-bold"
                  style={{ color: primary }}
                >
                  {storefrontName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>

            <p className="mt-2 text-sm font-bold text-neutral-900">{storefrontName}</p>

            <div className="mt-2 flex gap-1.5">
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-medium text-white"
                style={{ background: primary }}
              >
                ALL
              </span>
              <span className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                PIZZAS
              </span>
            </div>

            <div className="mt-3 w-full rounded-lg border border-neutral-200 bg-white p-2 text-left">
              <p className="text-xs font-semibold text-neutral-900">Margherita</p>
              <p className="text-[11px] text-neutral-500">San Marzano, basil.</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-900">$14.00</span>
                <span
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-white"
                  style={{ background: primary }}
                >
                  + Add
                </span>
              </div>
            </div>

            <span
              className="mt-2 w-full rounded-lg py-1.5 text-[11px] font-semibold text-white"
              style={{ background: accent }}
            >
              Checkout
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
