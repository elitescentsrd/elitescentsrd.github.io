-- REVISIÓN DE PERMISOS (solo lectura: no cambia nada).
-- Pégala en Supabase -> SQL Editor -> Run. Luego envía el resultado (botón "Export" -> "Copy as markdown", o una captura).
-- Muestra: tablas sin RLS, todas las políticas de acceso, funciones que un visitante puede ejecutar y los buckets de Storage.
with politicas as (
  select schemaname as esquema, tablename as tabla, policyname as politica, cmd as operacion,
         array_to_string(roles, ', ') as roles,
         left(regexp_replace(coalesce(qual, '-') || case when with_check is not null then '  | al escribir: ' || with_check else '' end, '\s+', ' ', 'g'), 140) as condicion
  from pg_policies
  where schemaname in ('public', 'storage')
)
select '1. Tabla SIN RLS (grave)' as revision, n.nspname || '.' || c.relname as detalle
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and n.nspname = 'public' and not c.relrowsecurity
union all
select '2. Política ' || esquema || '.' || tabla, politica || ' | ' || operacion || ' | ' || roles || ' | ' || condicion
  from politicas
union all
select '3. Función que un visitante puede ejecutar', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
union all
select '4. Bucket de Storage', b.id || ' | público: ' || b.public::text
  from storage.buckets b
order by 1, 2;
