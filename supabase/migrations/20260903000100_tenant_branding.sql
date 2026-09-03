-- =====================================================================
-- 20260903000100_tenant_branding.sql
-- Storefront theming: background colour and typeface.
--
-- These sit on `tenant_settings`, not on `tenants`, for the same reason
-- the existing brand colours and logo do: tenant_settings is readable by
-- anon for an active tenant, which is what lets a storefront render its
-- own theme without a session. `tenants` carries identity and billing and
-- is deliberately narrower.
-- =====================================================================

alter table public.tenant_settings
  add column if not exists background_color text not null default '#FFFFFF',
  add column if not exists font_family text not null default 'Inter';

-- Both are interpolated into a stylesheet, so they are constrained here as
-- well as validated in the application. A colour that is not a hex value,
-- or a font name containing punctuation, would be a CSS injection into the
-- tenant's own storefront.
alter table public.tenant_settings
  add constraint tenant_settings_background_color_chk
    check (background_color ~* '^#(?:[0-9a-f]{3}|[0-9a-f]{6})$');

alter table public.tenant_settings
  add constraint tenant_settings_font_family_chk
    check (font_family ~ '^[A-Za-z0-9 ]{2,48}$');

comment on column public.tenant_settings.background_color is
  'Storefront page background. Hex only -- interpolated into a <style> tag.';
comment on column public.tenant_settings.font_family is
  'Storefront typeface name. Letters, digits and spaces only, for the same reason.';

-- The platform's onboarding defaults for a newly provisioned restaurant.
alter table public.tenant_settings alter column brand_primary_color set default '#10B981';
alter table public.tenant_settings alter column brand_accent_color set default '#059669';
