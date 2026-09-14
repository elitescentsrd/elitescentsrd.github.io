-- Storage upload returns object metadata, so authorized admins also need SELECT.
create policy "Store admins read uploaded image metadata"
on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and (select private.is_store_admin())
);
