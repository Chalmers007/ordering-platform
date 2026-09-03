import Link from 'next/link';

/**
 * The banner on a storefront that has been built but not yet claimed.
 *
 * This page was assembled from the restaurant's own published menu, and the
 * person most likely to be reading it is the restaurant. So it has to say two
 * things plainly and immediately: this is a demonstration, and it is not
 * taking orders. Anything vaguer risks a diner believing they have ordered
 * dinner, or an owner believing prices they never approved are already live.
 *
 * No tenant id, token, or internal field appears here. The claim link is a
 * bearer credential and is never rendered on a public page — the call to
 * action leads to the sales route, which is where a real claim link is issued
 * from after the business is spoken to.
 *
 * Colours are chosen for the LIGHT storefront surface (brand-background
 * defaults to #FFFFFF). The first version used a dark-surface amber palette
 * and rendered amber-on-amber: the most important sentence on the page was
 * the one nobody could read.
 */
export function PreviewBanner({ ctaHref }: { ctaHref: string }) {
  return (
    <div className="border-b border-amber-300 bg-amber-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-900">Preview — not yet live</p>
          <p className="mt-1 text-sm text-neutral-800">
            This is a preview of your ordering storefront. Claim it to activate online ordering.
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            The menu below was read from your website. Nothing here can take an order or a payment yet,
            and prices are not live until you confirm them.
          </p>
        </div>
        <Link
          href={ctaHref}
          className="shrink-0 rounded-md bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
        >
          Claim This Storefront
        </Link>
      </div>
    </div>
  );
}
