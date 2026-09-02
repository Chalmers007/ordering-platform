const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const FALLBACK_PRIMARY = '#111827';
const FALLBACK_ACCENT = '#f97316';

/**
 * Brand colours are tenant-controlled text. They are interpolated into a
 * stylesheet, so anything that is not a plain hex colour is discarded —
 * otherwise a restaurant could inject arbitrary CSS into its own storefront
 * (and, via a shared portal, into anything rendered above it).
 */
export function safeHexColor(value: string | null | undefined, fallback: string): string {
  const candidate = (value ?? '').trim();
  return HEX.test(candidate) ? candidate : fallback;
}

/** The `:root` override for one tenant. Emitted as a <style> tag so the
 *  variables reach portalled content, which a wrapper element cannot. */
export function brandStyleSheet(primary: string | null, accent: string | null): string {
  return `:root{--brand-primary:${safeHexColor(primary, FALLBACK_PRIMARY)};--brand-accent:${safeHexColor(accent, FALLBACK_ACCENT)};}`;
}
