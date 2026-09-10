'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { uploadPreviewImage, removePreviewImage } from '@/lib/preview-personalisation/actions';

import { MAX_UPLOAD_BYTES } from '@/lib/preview-personalisation/validate';

type Kind = 'logo' | 'banner';

export function PersonalisePanel({
  tenantId,
  onImageChange,
  hasLogo,
  hasBanner,
  logoAssetId,
  bannerAssetId,
}: {
  tenantId?: string;
  onImageChange?: (kind: Kind, url: string | null) => void;
  hasLogo: boolean;
  hasBanner: boolean;
  logoAssetId: string | null;
  bannerAssetId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [updatedAssets, setUpdatedAssets] = useState<Partial<Record<Kind, { id: string } | null>>>({});
  const logoSet = updatedAssets.logo === undefined ? hasLogo : Boolean(updatedAssets.logo);
  const bannerSet = updatedAssets.banner === undefined ? hasBanner : Boolean(updatedAssets.banner);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const [pending, startTransition] = useTransition();
  const selectedKindRef = useRef<Kind | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    const kind = selectedKindRef.current;
    console.log('File input onChange fired', { file, kind, files: event.currentTarget.files });

    if (!file) {
      console.warn('No file selected');
      return;
    }

    if (!kind) {
      console.warn('No kind set when file was selected', kind);
      toast.error('Please select a file to replace first');
      return;
    }

    // Reject before transport: framework/platform limits run before the action.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Images must be 4MB or smaller.');
      selectedKindRef.current = null;
      event.currentTarget.value = '';
      return;
    }

    const form = new FormData();
    form.set('kind', kind);
    if (tenantId) form.set('tenantId', tenantId);
    form.set('file', file);

    startTransition(async () => {
      try {
        console.log('Starting upload for', kind, 'file:', file.name);
        const result = await uploadPreviewImage(form);
        console.log('Upload result:', result);
        try {
          if (!result.ok) {
            toast.error(result.message);
          } else {
            setUpdatedAssets((current) => ({ ...current, [kind]: { id: result.assetId } }));
            if (result.url) onImageChange?.(kind, result.url);
            if (kind === 'logo' ? bannerSet : logoSet) close();
            toast.success(kind === 'logo' ? 'Logo added to your preview' : 'Banner added to your preview');
          }
        } catch (uiError) {
          console.error('Failed to show upload result:', uiError);
          // Fail silently if we can't show toast — don't crash the component
        }
      } catch (error) {
        console.error('Upload error:', error);
        toast.error('Upload failed');
      } finally {
        selectedKindRef.current = null;
        // Clear input so same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    });
  };

  const handleUploadClick = (kind: Kind) => {
    console.log('Upload button clicked', kind);
    selectedKindRef.current = kind;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      console.log('Triggering file input click for', kind);
      fileInputRef.current.click();
    } else {
      console.error('File input ref not available');
      toast.error('Upload component not ready. Please refresh the page.');
    }
  };

  const remove = (assetId: string) => {
    startTransition(async () => {
      const result = await removePreviewImage(assetId, tenantId);
      if (!result.ok) toast.error(result.message);
      else {
        if (result.kind !== 'item') {
          setUpdatedAssets((current) => ({ ...current, [result.kind]: null }));
          onImageChange?.(result.kind, null);
        }
        toast.success('Image removed');
      }
    });
  };

  const row = (kind: Kind, label: string, has: boolean, assetId: string | null) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 py-3 first:border-t-0">
      <div>
        <p className="text-sm font-medium text-neutral-900">{label}</p>
        <p className="text-xs text-neutral-600">{has ? 'Added to your preview' : 'JPG, PNG or WebP · up to 4MB'}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => handleUploadClick(kind)}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 min-h-11 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
        >
          {has ? 'Replace' : 'Upload'}
        </button>
        {has && assetId ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => remove(assetId)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 min-h-11 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Upload branding image"
      />
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => open ? close() : setOpen(true)}
        className="min-h-11 rounded-md px-2 py-2 text-xs font-semibold text-amber-800 underline decoration-amber-300 underline-offset-4 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-700 sm:text-sm"
      >
        Customize Branding
      </button>
      {open ? (
        <section
          id={panelId}
          aria-label="Customize branding"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
          className="absolute right-0 top-full z-40 max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-amber-200 bg-white p-3 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-neutral-700">
              Add your own logo and banner to see how the storefront would look. No account needed.
            </p>
            <button
              type="button"
              onClick={close}
              className="min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50"
            >
              Done
            </button>
          </div>
          {row('logo', 'Logo', logoSet, updatedAssets.logo === undefined ? logoAssetId : updatedAssets.logo?.id ?? null)}
          {row('banner', 'Banner image', bannerSet, updatedAssets.banner === undefined ? bannerAssetId : updatedAssets.banner?.id ?? null)}
          <p className="mt-2 text-xs text-neutral-500">
            These images are saved to this browser only, and move onto your storefront when you activate
            it. Opening the preview on another device will not show them.
          </p>
        </section>
      ) : null}
    </div>
  );
}
