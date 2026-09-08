import { Toaster } from 'sonner';
import { DemoBuilderForm } from '@/components/demo-builder/form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Restaurant Demo Builder',
  description: 'Create an instant demo storefront for any restaurant.',
};

export default async function DemoBuilderPage() {
  return (
    <>
      <main className="flex min-h-dvh flex-col bg-neutral-50">
        {/* Header */}
        <div className="border-b border-neutral-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-2xl">
            <h1 className="text-2xl font-bold text-neutral-900">Demo Builder</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Create an instant ordering demo. No signup required.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-2xl">
            <DemoBuilderForm />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-2xl text-center text-xs text-neutral-600">
            <p>
              This demo will expire in 7 days. Restaurants can claim their storefront to unlock
              ordering and take it live.
            </p>
          </div>
        </div>
      </main>

      <Toaster position="top-center" richColors />
    </>
  );
}
