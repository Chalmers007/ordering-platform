'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { saveStoreSettings } from '@/app/(kds)/app/(dashboard)/settings/actions';
import { ThemeEditor, type Theme } from './theme-editor';
import type { Tenant, TenantSettings } from '@/types/database';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Hours = { dow: number; open: string; close: string };

/** Money is stored in cents; the form edits dollars. Converting at the
 *  edges keeps every calculation in between on integers. */
const toDollars = (cents: number) => (cents / 100).toFixed(2);
const toCents = (dollars: string) => Math.round(Number(dollars || '0') * 100);

function Section({
  title,
  description,
  children,
  locked,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  locked?: boolean;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-neutral-100">{title}</h2>
        {locked ? (
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
            Owner only
          </span>
        ) : null}
      </div>
      {description ? <p className="mt-0.5 text-sm text-neutral-400">{description}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-300">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'border-neutral-700 bg-neutral-950 text-neutral-100 placeholder:text-neutral-600 disabled:opacity-50';

export function StoreSettingsForm({
  tenant,
  settings,
  canManage,
}: {
  tenant: Tenant;
  settings: TenantSettings;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(tenant.name);
  const [supportEmail, setSupportEmail] = useState(tenant.support_email ?? '');
  const [supportPhone, setSupportPhone] = useState(tenant.support_phone ?? '');
  const [tagline, setTagline] = useState(settings.tagline ?? '');
  const [description, setDescription] = useState(settings.description ?? '');
  const [theme, setTheme] = useState<Theme>({
    primary: settings.brand_primary_color,
    accent: settings.brand_accent_color,
    background: settings.background_color,
    font: settings.font_family,
    logoUrl: settings.logo_url ?? '',
    bannerUrl: settings.cover_image_url ?? '',
  });

  const [acceptsDelivery, setAcceptsDelivery] = useState(settings.accepts_delivery);
  const [acceptsPickup, setAcceptsPickup] = useState(settings.accepts_pickup);
  const [radiusKm, setRadiusKm] = useState((settings.delivery_radius_meters / 1000).toString());
  const [prepMins, setPrepMins] = useState(settings.estimated_prep_time_mins.toString());
  const [deliveryFee, setDeliveryFee] = useState(toDollars(settings.delivery_fee_cents));
  const [minimum, setMinimum] = useState(toDollars(settings.delivery_minimum_cents));
  const [paused, setPaused] = useState(settings.is_kitchen_paused);

  const [hours, setHours] = useState<Hours[]>(() => {
    const stored = (settings.business_hours ?? []) as unknown as Hours[];
    // Always render seven rows: a missing day means closed, and an absent
    // row is invisible in a grid.
    return DAYS.map((_, dow) => stored.find((h) => h.dow === dow) ?? { dow, open: '', close: '' });
  });

  function setDay(dow: number, patch: Partial<Hours>) {
    setHours((current) => current.map((h) => (h.dow === dow ? { ...h, ...patch } : h)));
  }

  function submit() {
    startTransition(async () => {
      const result = await saveStoreSettings({
        ...(canManage ? { name, supportEmail, supportPhone } : {}),
        tagline,
        description,
        logoUrl: theme.logoUrl,
        bannerUrl: theme.bannerUrl,
        primaryColor: theme.primary,
        accentColor: theme.accent,
        backgroundColor: theme.background,
        fontFamily: theme.font,
        acceptsDelivery,
        acceptsPickup,
        deliveryRadiusMeters: Math.round(Number(radiusKm || '0') * 1000),
        estimatedPrepTimeMins: Number(prepMins || '0'),
        isKitchenPaused: paused,
        // Only complete rows are hours; a blank pair means the day is closed.
        businessHours: hours.filter((h) => h.open && h.close),
        ...(canManage
          ? { deliveryFeeCents: toCents(deliveryFee), deliveryMinimumCents: toCents(minimum) }
          : {}),
      });

      if (result.ok) toast.success('Settings saved');
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-4 pb-16">
      <Section
        title="General"
        description="How your restaurant appears to customers."
        locked={!canManage}
      >
        <Field label="Restaurant name">
          <Input className={inputClass} value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Support phone">
            <Input className={inputClass} value={supportPhone} disabled={!canManage} onChange={(e) => setSupportPhone(e.target.value)} />
          </Field>
          <Field label="Support email">
            <Input className={inputClass} type="email" value={supportEmail} disabled={!canManage} onChange={(e) => setSupportEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Tagline">
          <Input className={inputClass} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Wood-fired since 1994" />
        </Field>
        <Field label="Description">
          <Textarea className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </Section>

      <Section
        title="Branding & theme"
        description="Applied to your storefront the moment you save."
      >
        <ThemeEditor
          theme={theme}
          onChange={setTheme}
          storefrontName={name || tenant.name}
          disabled={false}
        />
      </Section>

      <Section title="Fulfilment & timing">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" className="h-4 w-4" checked={acceptsDelivery} onChange={(e) => setAcceptsDelivery(e.target.checked)} />
            Offer delivery
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" className="h-4 w-4" checked={acceptsPickup} onChange={(e) => setAcceptsPickup(e.target.checked)} />
            Offer pickup
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Delivery radius (km)">
            <Input className={inputClass} inputMode="decimal" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
          </Field>
          <Field label="Average prep time (minutes)">
            <Input className={inputClass} inputMode="numeric" value={prepMins} onChange={(e) => setPrepMins(e.target.value)} />
          </Field>
          <Field label="Delivery fee ($)">
            <Input className={inputClass} inputMode="decimal" value={deliveryFee} disabled={!canManage} onChange={(e) => setDeliveryFee(e.target.value)} />
          </Field>
          <Field label="Minimum order ($)">
            <Input className={inputClass} inputMode="decimal" value={minimum} disabled={!canManage} onChange={(e) => setMinimum(e.target.value)} />
          </Field>
        </div>
        {!canManage ? (
          <p className="text-xs text-neutral-500">
            Fees and minimums are owner-only. The database refuses the change either way, so
            they are disabled here rather than failing on save.
          </p>
        ) : null}
      </Section>

      <Section title="Operating hours" description="Leave a day blank to show it as closed.">
        <div className="space-y-2">
          {hours.map((day) => (
            <div key={day.dow} className="grid grid-cols-[6.5rem_1fr_1fr] items-center gap-2">
              <span className="text-sm text-neutral-300">{DAYS[day.dow]}</span>
              <Input className={inputClass} type="time" value={day.open} onChange={(e) => setDay(day.dow, { open: e.target.value })} aria-label={`${DAYS[day.dow]} opening time`} />
              <Input className={inputClass} type="time" value={day.close} onChange={(e) => setDay(day.dow, { close: e.target.value })} aria-label={`${DAYS[day.dow]} closing time`} />
            </div>
          ))}
        </div>

        <label className="mt-3 flex items-start gap-3 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium text-amber-200">Pause online ordering</span>
            <span className="mt-0.5 block text-xs text-amber-200/70">
              Customers can browse but not check out. Takes effect on the storefront
              immediately, and is recorded in the audit log.
            </span>
          </span>
        </label>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        <Button size="lg" loading={pending} onClick={submit} className="w-full sm:w-auto">
          Save settings
        </Button>
      </div>
    </div>
  );
}
