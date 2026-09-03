'use client';

import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Button to create a test preview tenant for upload testing.
 * Internal use only.
 */
export function CreateTestPreviewButton() {
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/test-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error ?? 'Failed to create test preview');
        return;
      }

      toast.success(`Test preview ready: ${data.previewUrl}`);

      // Copy URL to clipboard for convenience
      navigator.clipboard.writeText(data.previewUrl).catch(() => {
        // Silently fail if clipboard is not available
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? 'Creating...' : 'Create Test Preview'}
    </button>
  );
}
