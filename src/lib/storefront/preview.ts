import 'server-only';
import { headers } from 'next/headers';
import { TENANT_PREVIEW_HEADER } from '@/proxy';

/**
 * Is this request for a storefront that has been built but not yet claimed?
 *
 * Read from the header proxy.ts sets, which is stripped from every inbound
 * request before being set — so a visitor cannot forge it. Forging it would in
 * any case only turn ordering OFF.
 */
export async function isPreviewRequest(): Promise<boolean> {
  return (await headers()).get(TENANT_PREVIEW_HEADER) === '1';
}

/**
 * Where "Claim This Storefront" goes.
 *
 * NOT the claim link. That carries a token which grants ownership to whoever
 * opens it, and it is issued privately to the business — putting one on a
 * public page would hand the storefront to the first stranger who looked.
 *
 * This points at the sales route instead, which is where a real claim link is
 * issued from after someone has spoken to the business.
 */
export function claimCtaHref(): string {
  return '/sales/activate';
}

/**
 * Where "Book a Walkthrough" goes.
 *
 * A separate destination because it is a different intention: one prospect is
 * ready to buy, another wants to be shown around first, and sending both to the
 * same page loses the second. Falls back to the activation route when no
 * booking link is configured, so the button is never a dead end.
 */
export function walkthroughCtaHref(): string {
  return '/sales/walkthrough';
}
