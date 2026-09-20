-- AUDITORÍA DE SOLO LECTURA. Ejecuta cada bloque en Supabase -> SQL Editor y guarda los resultados.
-- No modifica nada. No devuelve datos de clientes: solo definiciones, permisos y políticas.
-- Sirve para (a) comparar el esquema real con supabase/*.sql y (b) generar la línea base.
-- Si algún resultado contiene un secreto o un dato personal, NO lo pegues en ningún chat ni en Git.

-- 1. Tablas de public/private y si tienen RLS activada (debe ser true en todas las de datos).
select n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls_activada, c.relforcerowsecurity as rls_forzada
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'private')
order by 1, 2;

-- 2. Columnas de las tablas del negocio (compáralas con schema.sql y proposed/01, proposed/02).
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('products', 'orders', 'admin_users', 'customer_profiles')
order by table_name, ordinal_position;

-- 3. Políticas RLS (esquemas public y storage). Esperado:
--    products: select público solo activos; escritura solo administradores.
--    orders: sin select para anon; clientes solo lo suyo; administradores todo.
--    storage.objects: insert/update/delete de 'product-images' solo administradores.
select schemaname, tablename, policyname, permissive, roles, cmd, qual as using_expr, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- 4. Permisos por rol sobre las tablas (anon NO debe tener INSERT/UPDATE/DELETE en products ni ningún permiso útil en orders).
select table_schema, table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'public')
group by 1, 2, 3
order by 2, 3;

-- 5. Funciones del negocio: permisos EXECUTE y definición (revisa que place_customer_order recalcule precios en el servidor).
select p.proname as funcion, pg_get_function_identity_arguments(p.oid) as argumentos, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_ejecuta,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_ejecuta
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prokind = 'f'
order by 1;
-- Definición completa de la RPC de pedidos:
select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'place_customer_order';

-- 6. Triggers sobre las tablas del negocio (p. ej. el que fuerza 'encargo' desde RD$7,000).
select event_object_table as tabla, trigger_name, event_manipulation as evento, action_timing as momento, action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by 1, 2;

-- 7. Restricciones CHECK (comprueba que orders.status admite preparando y enviado).
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
order by 1, 2;

-- 8. Bucket de imágenes: público, límite de 3 MB y tipos permitidos.
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets;

-- 9. Cuántos productos activos y cuántos ya tienen foto individual (solo cifras, sin datos personales).
select count(*) filter (where active) as activos,
       count(*) filter (where active and image_url is not null and image_url <> '') as con_foto,
       count(*) filter (where image_url like '%/pages/page-%') as apuntando_a_laminas
from public.products;

-- 10. Administradores registrados (solo cuántos; no muestres los IDs).
select count(*) as administradores from public.admin_users;
