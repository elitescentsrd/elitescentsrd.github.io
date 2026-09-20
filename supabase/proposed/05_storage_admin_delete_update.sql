-- PROPUESTA — revisar antes de ejecutar.
-- Hoy storage.objects solo tiene políticas de INSERT y SELECT para admins
-- (supabase/20260914_product_images.sql, supabase/20260914_product_image_select.sql).
-- Sin DELETE/UPDATE, las fotos reemplazadas quedan huérfanas en el bucket
-- product-images. Esto agrega ambas, limitadas al mismo bucket y a
-- administradores autenticados.

create policy "Store admins update product images"
on storage.objects for update to authenticated
using (bucket_id = 'product-images' and (select private.is_store_admin()))
with check (bucket_id = 'product-images' and (select private.is_store_admin()));

create policy "Store admins delete product images"
on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (select private.is_store_admin()));
