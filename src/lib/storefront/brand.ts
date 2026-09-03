const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT = /^[A-Za-z0-9 ]{2,48}$/;

export const BRAND_DEFAULTS = {
  primary: '#10B981',
  accent: '#059669',
  background: '#FFFFFF',
  font: 'Inter',
} as const;

/**
 * Brand values are tenant-controlled text that gets interpolated into a
 * stylesheet. Anything that is not a plain hex colour — or, for the font, a
 * bare family name — is discarded, because otherwise a restaurant could
 * inject arbitrary CSS into its own storefront and, through a shared
 * portal, into anything rendered above it.
 *
 * The database carries the same constraints; this is the second gate, not
 * the only one.
 */
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  const candidate = (value ?? '').trim();
  return HEX.test(candidate) ? candidate : fallback;
}

export function safeFontFamily(value: string | null | undefined, fallback: string): string {
  const candidate = (value ?? '').trim();
  return FONT.test(candidate) ? candidate : fallback;
}

export type BrandInput = {
  primary: string | null;
  accent: string | null;
  background?: string | null;
  font?: string | null;
};

/**
 * The `:root` override for one tenant.
 *
 * Emitted as a <style> tag rather than an inline style on a wrapper,
 * because Radix renders dialogs into a portal on <body> — a variable
 * scoped to a layout element never reaches them, and every portalled
 * button silently loses its background.
 */
export function brandStyleSheet(brand: BrandInput): string {
  const primary = safeHexColor(brand.primary, BRAND_DEFAULTS.primary);
  const accent = safeHexColor(brand.accent, BRAND_DEFAULTS.accent);
  const background = safeHexColor(brand.background, BRAND_DEFAULTS.background);
  const font = safeFontFamily(brand.font, BRAND_DEFAULTS.font);

  return [
    ':root{',
    `--brand-primary:${primary};`,
    `--brand-accent:${accent};`,
    `--brand-background:${background};`,
    // A real stack, not a bare name: the tenant's choice may not be
    // installed on the visitor's device.
    `--brand-font:"${font}",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;`,
    '}',
  ].join('');
}
