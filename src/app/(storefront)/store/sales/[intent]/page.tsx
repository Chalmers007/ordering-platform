import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const destinations = {
  activate: {
    env: 'ACTIVATION_SALES_URL',
    eyebrow: 'Activate your storefront',
    title: 'Sales setup is being finalized',
    body: 'Your preview is safe and will remain unable to take orders. Contact your Vardr representative to continue activation.',
  },
  walkthrough: {
    env: 'WALKTHROUGH_SALES_URL',
    eyebrow: 'Book a walkthrough',
    title: 'Scheduling is being finalized',
    body: 'Contact your Vardr representative to schedule a walkthrough of this storefront.',
  },
} as const;

type Intent = keyof typeof destinations;

function safeHttpUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default async function SalesHandoffPage({
  params,
}: {
  params: Promise<{ intent: string }>;
}) {
  const { intent: rawIntent } = await params;
  if (!(rawIntent in destinations)) notFound();

  const intent = rawIntent as Intent;
  const copy = destinations[intent];
  const destination = safeHttpUrl(process.env[copy.env]);
  if (destination) redirect(destination);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{copy.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold text-neutral-900">{copy.title}</h1>
        <p className="mt-3 text-neutral-600">{copy.body}</p>
      </div>
    </main>
  );
}
