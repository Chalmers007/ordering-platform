/**
 * Shown when someone reaches a restaurant dashboard that their account does
 * not belong to.
 *
 * The common case is a platform administrator: resolveStaffTenantId() returns
 * null for a super admin outside impersonation, and the old behaviour was
 * notFound(). A 404 tells a person the page is missing when in fact they are
 * signed in as the wrong account — so they retry the same URL, and it fails
 * the same way.
 *
 * Nothing about the tenant is named here. This renders for a visitor with no
 * claim to it, so it must not confirm which restaurant lives at this address.
 */
export function WrongAccountNotice() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-neutral-100">This dashboard belongs to a restaurant</h1>
        <p className="mt-3 text-sm text-neutral-400">
          You are signed in, but not with an account that has access here. If you are the owner, sign in
          with the address you used when you claimed the storefront. If you are a platform administrator,
          open this restaurant from the admin console instead.
        </p>
        <p className="mt-6 text-sm">
          <a href="/login" className="font-medium text-amber-400 hover:text-amber-300">
            Sign in with a different account
          </a>
        </p>
      </div>
    </main>
  );
}
