import { requireSuperAdmin } from '@/lib/admin/guard';
import { SearchDeliveries } from './search-deliveries';

export const metadata = { title: 'Dispatch Support' };

export default async function DispatchSupportPage() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return <div className="p-6 text-red-600">Access denied</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dispatch Support</h1>
        <p className="mt-2 text-gray-600">Search orders, view delivery status, and manually retry or cancel deliveries</p>
      </div>

      <SearchDeliveries />
    </div>
  );
}
