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
 * home, so this sends them there.
 */
export default async function StaffHome() {
  const staff = await resolveStaffTenantId();
  redirect(staff ? '/kds' : '/login?next=/kds');
}
