'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CreateRestaurantDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    ownerEmail: '',
    ownerName: '',
    supportEmail: '',
    supportPhone: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const body = (await response.json().catch(() => null)) as any;

      if (!response.ok) {
        const errorMsg = body?.error ?? body?.fieldErrors ? JSON.stringify(body.fieldErrors) : 'Failed to create restaurant';
        toast.error(errorMsg);
        console.error('Create restaurant failed:', { status: response.status, body });
        return;
      }

      if (!body?.tenant?.id) {
        const message = Array.isArray(body) && body[0]?.id
          ? 'Data returned but in unexpected format'
          : 'No restaurant returned from server';
        toast.error(message);
        console.error('Invalid response structure:', { body, isArray: Array.isArray(body), keys: body ? Object.keys(body) : null });
        return;
      }

      toast.success(`Created "${body.tenant.name || formData.name}"`);
      setOpen(false);
      setFormData({
        name: '',
        slug: '',
        ownerEmail: '',
        ownerName: '',
        supportEmail: '',
        supportPhone: '',
      });
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="bg-blue-600 hover:bg-blue-700">
        + Create Restaurant
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold mb-4">Create Restaurant</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Restaurant Name *</label>
            <Input
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Scott's Pizza"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Subdomain (slug)</label>
            <Input
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              placeholder="e.g., scotts-pizza (auto-generated if left blank)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Owner Email *</label>
            <Input
              required
              type="email"
              value={formData.ownerEmail}
              onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
              placeholder="owner@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Owner Name</label>
            <Input
              value={formData.ownerName}
              onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
              placeholder="Scott Chalmers"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Support Email</label>
            <Input
              type="email"
              value={formData.supportEmail}
              onChange={(e) => setFormData({ ...formData, supportEmail: e.target.value })}
              placeholder="support@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Support Phone</label>
            <Input
              value={formData.supportPhone}
              onChange={(e) => setFormData({ ...formData, supportPhone: e.target.value })}
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" loading={loading} className="bg-blue-600 hover:bg-blue-700">
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
