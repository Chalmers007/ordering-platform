'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface DemoResult {
  tenant_id: string;
  slug: string;
  preview_url: string;
  state: string;
  expires_at: string;
}

interface DemoError {
  error?: string;
  issues?: Array<{ field?: string; message?: string }>;
}

async function uploadOptionalFile(tenantId: string, kind: 'logo' | 'menu', file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`/api/demo/${tenantId}/${kind}`, {
    method: 'POST',
    body: formData,
  });
  if (response.ok) return null;

  let message = `Failed to upload ${kind}`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // Keep a useful fallback when a proxy returns a non-JSON error page.
  }
  return message;
}

export function DemoBuilderForm() {
  const [restaurantName, setRestaurantName] = useState('');
  const [foodType, setFoodType] = useState('');
  const [website, setWebsite] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [menuFile, setMenuFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const menuInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = restaurantName.trim().length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    try {
      const formData = new FormData();
      formData.append('name', restaurantName.trim());
      if (foodType.trim()) {
        formData.append('food_type', foodType.trim());
      }
      if (website.trim()) {
        formData.append('website', website.trim());
      }
      if (logoFile) {
        formData.append('logo', logoFile);
      }
      if (menuFile) {
        formData.append('menu', menuFile);
      }

      const response = await fetch('/api/demo-builder/create', {
        method: 'POST',
        body: formData,
      });

      const data = (await response.json()) as DemoResult | DemoError;

      if (!response.ok) {
        const failure = data as DemoError;
        const details = failure.issues?.map((issue) => issue.message).filter(Boolean).join(' ');
        toast.error(details || failure.error || 'Failed to create demo');
        setBusy(false);
        return;
      }

      const created = data as DemoResult;
      const errors: string[] = [];
      if (logoFile) {
        const error = await uploadOptionalFile(created.tenant_id, 'logo', logoFile);
        if (error) errors.push(`Logo: ${error}`);
      }
      if (menuFile) {
        const error = await uploadOptionalFile(created.tenant_id, 'menu', menuFile);
        if (error) errors.push(`Menu: ${error}`);
      }
      setUploadErrors(errors);
      setResult(created);
      if (errors.length > 0) {
        toast.error(`Demo created, but ${errors.length === 1 ? 'an upload needs attention' : 'uploads need attention'}.`);
      } else {
        toast.success('Demo created successfully!');
      }
    } catch (err) {
      toast.error('Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <Card className="border-green-200 bg-green-50 p-6">
          <h2 className="text-lg font-semibold text-green-900">Demo Ready!</h2>
          <p className="mt-2 text-sm text-green-800">
            {result.state === 'reused' ? 'Using existing demo for this restaurant.' : 'Demo created successfully.'}
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-green-700">Preview URL</label>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-green-100 px-3 py-2 text-sm font-mono text-green-900">
                  {result.preview_url}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(result.preview_url);
                    toast.success('Copied to clipboard');
                  }}
                  className="flex-shrink-0 rounded bg-green-200 px-3 py-2 text-xs font-medium text-green-900 hover:bg-green-300"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-green-700">Share with owner</label>
              <p className="mt-1 text-xs text-green-800">
                Send them this link. They can upload their logo and menu, then claim their storefront.
              </p>
            </div>

            {uploadErrors.length > 0 && (
              <div role="alert" className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">Some uploads need attention</p>
                <ul className="mt-1 list-inside list-disc">
                  {uploadErrors.map((error) => <li key={error}>{error}</li>)}
                </ul>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-green-700">Session expires</label>
              <p className="mt-1 text-xs text-green-800">
                {new Date(result.expires_at).toLocaleDateString()} at{' '}
                {new Date(result.expires_at).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => {
                window.open(result.preview_url, '_blank');
              }}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Open Demo
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setRestaurantName('');
                setFoodType('');
                setWebsite('');
                setLogoFile(null);
                setMenuFile(null);
                setUploadErrors([]);
              }}
              className="flex-1 rounded-lg bg-white px-4 py-2 text-sm font-medium text-green-600 ring-1 ring-green-200 hover:bg-green-50"
            >
              Create Another
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Restaurant Name</h2>
        <p className="mt-1 text-sm text-neutral-600">Required. This is what appears on the demo.</p>

        <Input
          required
          autoComplete="off"
          aria-label="Restaurant name"
          placeholder="e.g., Mario's Pizza"
          value={restaurantName}
          onChange={(e) => setRestaurantName(e.target.value)}
          className="mt-3"
        />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Food Type (optional)</h2>
        <p className="mt-1 text-sm text-neutral-600">Helps us describe the sample storefront.</p>

        <Input
          autoComplete="off"
          aria-label="Food type"
          placeholder="e.g., Italian, seafood, coffee"
          value={foodType}
          onChange={(e) => setFoodType(e.target.value)}
          className="mt-3"
        />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Website (optional)</h2>
        <p className="mt-1 text-sm text-neutral-600">
          We&apos;ll automatically scrape your logo and menu if you provide this.
        </p>

        <Input
          type="url"
          autoComplete="url"
          aria-label="Restaurant website"
          placeholder="https://..."
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="mt-3"
        />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Logo (optional)</h2>
        <p className="mt-1 text-sm text-neutral-600">PNG, JPG, or GIF. Max 5MB.</p>

        <div className="mt-3">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => setLogoFile(e.currentTarget.files?.[0] || null)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
          >
            {logoFile ? (
              <>
                <span className="text-green-600">✓ {logoFile.name}</span>
              </>
            ) : (
              'Tap to upload logo'
            )}
          </button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Menu (optional)</h2>
        <p className="mt-1 text-sm text-neutral-600">PDF or image. We&apos;ll extract the items.</p>

        <div className="mt-3">
          <input
            ref={menuInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.gif"
            onChange={(e) => setMenuFile(e.currentTarget.files?.[0] || null)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => menuInputRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
          >
            {menuFile ? (
              <>
                <span className="text-green-600">✓ {menuFile.name}</span>
              </>
            ) : (
              'Tap to upload menu'
            )}
          </button>
        </div>
      </Card>

      <Button type="submit" size="lg" className="w-full" disabled={!canSubmit} loading={busy}>
        {busy ? 'Creating Demo...' : 'Generate Demo'}
      </Button>

      <Card className="bg-blue-50 p-4">
        <p className="text-xs text-blue-900">
          <span className="font-semibold">Demo — not yet live.</span> The storefront is read-only. Customers can see
          your menu, but they cannot place orders until you claim it and we verify everything.
        </p>
      </Card>
    </form>
  );
}
