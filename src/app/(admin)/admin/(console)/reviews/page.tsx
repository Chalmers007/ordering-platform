import Link from 'next/link';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) redirect('/');
  const db = createServiceClient() as any;
  const { data: tenants } = await db.from('tenants').select('id, name, slug, status, support_email, tenant_activation_requirements(operator_decision, operator_reason)').eq('status', 'pending').order('updated_at', { ascending: false });
  const rows = (tenants ?? []).filter((t: any) => t.tenant_activation_requirements?.[0]?.operator_decision !== 'approved');
  return (
    <section>
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-semibold">Restaurant setup review</h1><p className="mt-1 text-sm text-neutral-600">Claimed restaurants waiting for an operator decision.</p></div><Link href="/admin" className="text-sm underline">Back to overview</Link></div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-neutral-200 bg-white"><table className="w-full min-w-[42rem] text-sm"><thead className="border-b text-left text-xs uppercase text-neutral-500"><tr><th className="px-4 py-3">Restaurant</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Review</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-neutral-100">{rows.length ? rows.map((t: any) => { const r = t.tenant_activation_requirements?.[0]; return <tr key={t.id}><td className="px-4 py-3"><p className="font-medium">{t.name}</p><p className="text-xs text-neutral-500">{t.slug}</p></td><td className="px-4 py-3">{t.support_email ?? 'Not provided'}</td><td className="px-4 py-3">{r?.operator_decision === 'rejected' ? 'Needs changes' : 'Awaiting review'}</td><td className="px-4 py-3 text-right"><Link className="font-medium text-blue-700 underline" href={`/admin/reviews/${t.id}`}>Review</Link></td></tr>; }) : <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-500">No claimed restaurants need review.</td></tr>}</tbody></table></div>
    </section>
  );
}
