'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { removeMenuItemImage, uploadMenuItemImage } from '@/app/(kds)/app/(dashboard)/menu/actions';

export function MenuItemPhoto({ itemId, imagePath }: { itemId: string; imagePath: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [hasPhoto, setHasPhoto] = useState(Boolean(imagePath));

  function upload(file: File) {
    const form = new FormData();
    form.set('file', file);
    startTransition(async () => {
      const result = await uploadMenuItemImage(itemId, form);
      if (!result.ok) { toast.error(result.error); return; }
      setHasPhoto(true);
      toast.success('Item photo saved');
    });
  }

  return (
    <span className="flex items-center gap-2 text-xs text-neutral-400">
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          event.target.value = '';
        }}
      />
      <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => input.current?.click()}>
        {hasPhoto ? 'Replace photo' : 'Add photo'}
      </Button>
      {hasPhoto ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await removeMenuItemImage(itemId);
            if (!result.ok) { toast.error(result.error); return; }
            setHasPhoto(false);
            toast.success('Item photo removed');
          })}
        >
          Remove
        </Button>
      ) : null}
    </span>
  );
}
