/**
 * Demo fallback upload section for storefront.
 * Allows restaurant to upload logo and menu during preview phase.
 * Both are optional; missing them doesn't prevent preview.
 */

'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { FallbackState } from '@/lib/demo/fallback';

export interface DemoUploadSectionProps {
  tenantId: string;
  state: FallbackState;
  logoUrl?: string | null;
  onUploadComplete?: () => void;
}

export function DemoUploadSection({
  tenantId,
  state,
  logoUrl,
  onUploadComplete,
}: DemoUploadSectionProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoUploaded, setLogoUploaded] = useState(!!logoUrl);
  const [menuUploaded, setMenuUploaded] = useState(false);

  // Only show uploads during editable states
  if (!['created', 'awaiting_logo', 'awaiting_menu', 'preview_ready'].includes(state)) {
    return null;
  }

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file for your logo');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Logo file must be less than 5MB');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/demo/${tenantId}/logo`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to upload logo');
      }

      setLogoUploaded(true);
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleMenuUpload = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/demo/${tenantId}/menu`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to upload menu');
      }

      setMenuUploaded(true);
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 border-t pt-6">
      <h3 className="text-lg font-semibold">Customize Your Preview</h3>

      {/* Logo Upload */}
      <div className="space-y-2">
        <label htmlFor="logo-upload" className="block text-sm font-medium">
          Upload Your Logo
          {logoUploaded && <span className="ml-2 text-green-600">✓ Uploaded</span>}
        </label>
        <p className="text-sm text-gray-600">Optional. PNG or JPG, up to 5MB.</p>
        {logoUrl && (
          <div className="mb-3 flex gap-2">
            <Image src={logoUrl} alt="Restaurant logo" width={64} height={64} className="rounded object-cover" />
            <button
              type="button"
              onClick={() => {
                const input = document.getElementById('logo-upload') as HTMLInputElement;
                if (input) input.click();
              }}
              disabled={uploading}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400"
            >
              Change Logo
            </button>
          </div>
        )}
        <input
          id="logo-upload"
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) handleLogoUpload(file);
          }}
          className="block w-full text-sm file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700 disabled:file:bg-gray-400"
        />
      </div>

      {/* Menu Upload */}
      <div className="space-y-2">
        <label htmlFor="menu-upload" className="block text-sm font-medium">
          Upload Your Menu
          {menuUploaded && <span className="ml-2 text-green-600">✓ Uploaded</span>}
        </label>
        <p className="text-sm text-gray-600">
          Optional. Replace the sample menu. Accepted: PDF, image, or text file.
        </p>
        <input
          id="menu-upload"
          type="file"
          accept=".pdf,image/*,.txt"
          disabled={uploading}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) handleMenuUpload(file);
          }}
          className="block w-full text-sm file:mr-4 file:rounded file:border-0 file:bg-green-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-green-700 disabled:file:bg-gray-400"
        />
      </div>

      {/* Status */}
      {uploading && <p className="text-sm text-gray-600">Uploading...</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {/* Sample Menu Notice */}
      {!menuUploaded && (
        <div className="rounded bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium">Using Sample Menu</p>
          <p>You&apos;re currently viewing a demo menu. Upload your real menu before claiming the storefront.</p>
        </div>
      )}
    </div>
  );
}
