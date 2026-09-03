'use client';

import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { uploadBrandingImage } from '@/app/(kds)/app/(dashboard)/settings/upload';
import { Button } from '@/components/ui/button';

/**
 * Upload button for branding images (logo, hero banner).
 *
 * Handles file selection, validation feedback, and calls the upload server action.
 * Auto-fills the URL field when upload succeeds.
 */
export function ImageUploadButton({
  type,
  currentUrl,
  onUrlChange,
  disabled,
}: {
  type: 'logo' | 'banner';
  currentUrl: string;
  onUrlChange: (url: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await uploadBrandingImage(formData, type);

      if ('data' in result && result.data) {
        onUrlChange(result.data.url);
      } else if ('error' in result) {
        setError(result.error || 'Upload failed');
      } else {
        setError('Upload failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleInputChange}
          disabled={disabled || uploading}
          className="hidden"
          aria-label={`Upload ${type} image`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          {uploading ? 'Uploading...' : `Upload ${type}`}
        </Button>
        {currentUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || uploading}
            onClick={() => onUrlChange('')}
            className="gap-2 text-red-500 hover:bg-red-500/10 hover:text-red-600"
          >
            <X className="h-4 w-4" />
            Remove
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <p className="text-xs text-neutral-500">JPG, PNG, or WebP • Max 5MB</p>
    </div>
  );
}
