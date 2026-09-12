import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSuperAdmin } from '@/lib/admin/guard';
import { createServiceClient } from '@/lib/supabase/server';
import { ReviewDecisionForm } from '@/components/admin/review-decision-form';

export const dynamic = 'force-dynamic';

export default async function ReviewDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) notFound();
  const { tenantId } = await params;
  const db = createServiceClient() as any;
  const [{ data: tenant }, { data: settings }, { data: requirements }, { data: purchase }, { count: ownerItems }] = await Promise.all([
    db.from('tenants').select('id, name, slug, status, support_email, support_phone').eq('id', tenantId).maybeSingle(),
    db.from('tenant_settings').select('logo_url, cover_image_url').eq('tenant_id', tenantId).maybeSingle(),
    db.from('tenant_activation_requirements').select('owner_approved_at, operator_approved_at, operator_decision, operator_reason').eq('tenant_id', tenantId).maybeSingle(),
    db.from('package_purchases').select('status').eq('tenant_id', tenantId).maybeSingle(),
    db.from('menu_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('source', 'owner'),
  ]);
  if (!tenant || tenant.status !== 'pending') notFound();
  const details = Boolean(tenant.support_email && tenant.support_phone);
  const checks = [
    ['Business details', details], ['Logo', Boolean(settings?.logo_url)], ['Banner', Boolean(settings?.cover_image_url)],
    ['Owner menu draft', (ownerItems ?? 0) > 0], ['Payment confirmed', purchase?.status === 'confirmed'], ['Owner approval', Boolean(requirements?.owner_approved_at)],
  ];
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim();
  const previewUrl = root ? `${root.startsWith('localhost') ? 'http' : 'https'}://${root}/preview/${tenant.id}` : `/preview/${tenant.id}`;
  return <section className="max-w-3xl"><Link href="/admin/reviews" className="text-sm underline">← Review queue</Link><h1 className="mt-3 text-2xl font-semibold">{tenant.name}</h1><p className="text-sm text-neutral-600">{tenant.slug} · {tenant.id}</p><div className="mt-4 rounded-xl border bg-white p-5"><p className="text-sm"><span className="font-medium">Preview:</span> <a className="text-blue-700 underline" href={previewUrl} target="_blank" rel="noreferrer">Open preview</a></p><ul className="mt-4 space-y-2 text-sm">{checks.map(([label, complete]) => <li key={label as string}>{complete ? '✓' : '○'} {label as string}</li>)}</ul><p className="mt-4 text-sm"><span className="font-medium">Payment:</span> {purchase?.status ?? 'Not started'}</p><p className="mt-1 text-sm"><span className="font-medium">Decision:</span> {requirements?.operator_decision ?? 'pending'}{requirements?.operator_reason ? ` — ${requirements.operator_reason}` : ''}</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><ReviewDecisionForm tenantId={tenant.id} decision="approved" /><ReviewDecisionForm tenantId={tenant.id} decision="rejected" /></div><p className="mt-4 text-xs text-neutral-500">Approval records the operator decision only. The storefront remains preview-only until every activation requirement is satisfied.</p></div></section>;
}
