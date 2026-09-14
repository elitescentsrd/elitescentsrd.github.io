-- Only authenticated administrators may upload product photos.
-- Public bucket content is intentionally readable so storefront images work.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,3145728,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "Store admins upload product images"
on storage.objects for insert to authenticated
with check (
 bucket_id = 'product-images'
 and (select private.is_store_admin())
);
