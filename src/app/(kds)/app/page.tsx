import { redirect } from 'next/navigation';
import { resolveStaffTenantId } from '@/lib/admin/guard';

export const dynamic = 'force-dynamic';

/**
 * The staff dashboard root.
 *
 * `app.<root>/` previously fell through to a 404: the proxy rewrites it to
 * `/app`, and only `/app/kds` and `/app/login` existed. Anyone typing the
 * bare hostname — including a super admin arriving from "Log in as" — hit
 * a dead end.
 *
 * There is no separate /dashboard route; the kitchen display IS the staff
 * home, so this sends them there. The redirect targets are `/app/...`
 * (not the bare `/kds` / `/login` this file used before) because "Log in
 * as" now keeps the admin on their own host and reaches this page through
 * the path-based `/app/*` override in proxy.ts, not the `app.<root>`
 * hostname. A bare `/kds` would fall through to that host's OWN
 * hostname-based surface instead of `/app`, landing on the wrong section
 * (e.g. `/admin/kds` on the admin host) — the `/app` prefix is what keeps
 * the redirect correct on every host.
 */
export default async function StaffHome() {
  const staff = await resolveStaffTenantId();
  redirect(staff ? '/app/kds' : '/app/login?next=/app/kds');
}
