-- Store approved external image URLs for generated and imported menu items.
-- Generated demos use curated Unsplash URLs; production uploads continue to
-- use image_path and the existing Supabase Storage flow.
alter table public.menu_items
  add column if not exists image_url text;

alter table public.menu_items
  drop constraint if exists menu_items_image_url_chk;

alter table public.menu_items
  add constraint menu_items_image_url_chk
  check (image_url is null or image_url ~ '^https://');

comment on column public.menu_items.image_url is
  'Approved external image URL for menu display; uploaded assets use image_path.';
