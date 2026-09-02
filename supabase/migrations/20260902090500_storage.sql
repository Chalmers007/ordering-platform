-- =====================================================================
-- 20260902090500_storage.sql
-- Buckets and object-level policies.
--
-- Object key convention (enforced below, not just by convention):
--   menu-images/<tenant_id>/menu-items/<uuid>.<ext>
--   brand-assets/<tenant_id>/logo.<ext>
-- The first path segment IS the tenant id, so isolation is a string
-- comparison against the caller's tenant.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-images', 'menu-images', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('brand-assets', 'brand-assets', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A non-uuid first segment must DENY, not raise. A cast in a policy
-- expression that throws surfaces as a 500, not a 403.
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.safe_uuid(text) to anon, authenticated;

-- Public read: storefronts are anonymous by definition.
create policy "public read menu images"
  on storage.objects for select to anon, authenticated
  using (bucket_id in ('menu-images', 'brand-assets'));

-- Writes are confined to the caller's own tenant folder.
create policy "tenant members write menu images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('menu-images', 'brand-assets')
    and public.has_tenant_access(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "tenant members update menu images"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('menu-images', 'brand-assets')
    and public.has_tenant_access(public.safe_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id in ('menu-images', 'brand-assets')
    and public.has_tenant_access(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "tenant members delete menu images"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('menu-images', 'brand-assets')
    and public.has_tenant_access(public.safe_uuid((storage.foldername(name))[1]))
  );
