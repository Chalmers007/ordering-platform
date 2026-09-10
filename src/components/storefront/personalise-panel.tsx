'use client';

import { useRef, useState, useTransition, RefObject } from 'react';
import { toast } from 'sonner';
import { uploadPreviewImage, removePreviewImage } from '@/lib/preview-personalisation/actions';

/**
 * Lets a restaurant put its own logo and banner on a preview before claiming.
 *
 * No account, no email, no card. The images live in this browser's session
 * until the storefront is claimed, and the panel says so — an owner who
 * uploads a logo, closes the laptop and opens the link on a phone would
 * otherwise wonder where it went. Carrying it across devices would need an
 * email or a phone number, which is the thing this deliberately does not ask
 * for.
 */
type Kind = 'logo' | 'banner';

function Row({
  kind,
  label,
  has,
  assetId,
  inputRef,
  pending,
  onUpload,
  onRemove,
}: {
  kind: Kind;
  label: string;
  has: boolean;
  assetId: string | null;
  inputRef: RefObject<HTMLInputElement>;
  pending: boolean;
  onUpload: (kind: Kind, file: File) => void;
  onRemove: (assetId: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-amber-200 py-3 first:border-t-0">
      <div>
        <p className="text-sm font-medium text-neutral-900">{label}</p>
        <p className="text-xs text-neutral-600">{has ? 'Added to your preview' : 'JPG, PNG or WebP · up to 5MB'}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(kind, file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
        >
          {has ? 'Replace' : 'Upload'}
        </button>
        {has && assetId ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onRemove(assetId)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PersonalisePanel({
  hasLogo,
  hasBanner,
  logoAssetId,
  bannerAssetId,
}: {
  hasLogo: boolean;
  hasBanner: boolean;
  logoAssetId: string | null;
  bannerAssetId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const upload = (kind: Kind, file: File) => {
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    startTransition(async () => {
      const result = await uploadPreviewImage(form);
      if (!result.ok) toast.error(result.message);
      else toast.success(kind === 'logo' ? 'Logo added to your preview' : 'Banner added to your preview');
    });
  };

  const remove = (assetId: string) => {
    startTransition(async () => {
      const result = await removePreviewImage(assetId);
      if (!result.ok) toast.error(result.message);
      else toast.success('Image removed');
    });
  };

  return (
    <div className="mt-3 border-t border-amber-200 pt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-amber-500 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
        >
          Personalize This Preview
        </button>
      ) : (
        <div className="rounded-md border border-amber-200 bg-white p-3">
          <p className="text-sm text-neutral-700">
            Add your own logo and banner to see how the storefront would look. No account needed.
          </p>
          <Row
            kind="logo"
            label="Logo"
            has={hasLogo}
            assetId={logoAssetId}
            inputRef={logoInput}
            pending={pending}
            onUpload={upload}
            onRemove={remove}
          />
          <Row
            kind="banner"
            label="Banner image"
            has={hasBanner}
            assetId={bannerAssetId}
            inputRef={bannerInput}
            pending={pending}
            onUpload={upload}
            onRemove={remove}
          />
          <p className="mt-3 text-xs text-neutral-500">
            These images are saved to this browser only, and move onto your storefront when you activate
            it. Opening the preview on another device will not show them.
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 text-sm text-neutral-500 underline hover:text-neutral-700"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
