-- CUENTAS CLIENTES: vista para el panel de administración (y para ti en el Table Editor de Supabase).
--
-- Dónde viven las cuentas: Supabase guarda el correo y la contraseña CIFRADA en Authentication -> Users (auth.users)
-- y los datos del cliente (nombre, teléfono, cédula, dirección) en public.customer_profiles. La contraseña nunca se
-- puede ver ni recuperar en texto: solo se puede restablecer; eso es una protección, no una limitación.
--
-- Esta migración crea:
--   * private.cuentas_clientes  -> vista de solo lectura que junta cuenta + perfil + pedidos + origen del registro.
--                                  Consúltala en Table Editor eligiendo el esquema "private".
--   * public.admin_list_customers() -> función que el panel usa; solo responde a administradores.
-- El origen del registro (fuente, dispositivo, navegador, idioma, zona horaria) lo envía la web al crear la cuenta y se
-- guarda en raw_user_meta_data->'origen'. La IP y el país los conserva Supabase en Logs -> Auth; no se copian aquí.

create schema if not exists private;

create or replace view private.cuentas_clientes as
select
  u.id                                    as user_id,
  u.email                                 as correo,
  u.created_at                            as cuenta_creada,
  u.email_confirmed_at                    as correo_confirmado,
  u.last_sign_in_at                       as ultimo_acceso,
  exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa_activo,
  p.first_name                            as nombre,
  p.last_name                             as apellidos,
  p.phone                                 as telefono,
  u.raw_user_meta_data -> 'origen'        as origen,
  (select count(*) from public.orders o where o.user_id = u.id) as pedidos
from auth.users u
left join public.customer_profiles p on p.user_id = u.id
where not exists (select 1 from public.admin_users a where a.user_id = u.id);

revoke all on private.cuentas_clientes from public, anon, authenticated;

create or replace function public.admin_list_customers()
returns table (
  user_id uuid, correo text, cuenta_creada timestamptz, correo_confirmado timestamptz, ultimo_acceso timestamptz,
  mfa_activo boolean, nombre text, apellidos text, telefono text, origen jsonb, pedidos bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id, c.correo::text, c.cuenta_creada, c.correo_confirmado, c.ultimo_acceso,
         c.mfa_activo, c.nombre::text, c.apellidos::text, c.telefono::text, c.origen, c.pedidos
  from private.cuentas_clientes c
  where (select private.is_store_admin())
  order by c.cuenta_creada desc
$$;

revoke all on function public.admin_list_customers() from public, anon;
grant execute on function public.admin_list_customers() to authenticated;

-- Comprobación (como administrador con sesión, desde el panel): debe listar tus cuentas de cliente.
-- Comprobación desde el SQL Editor (rol postgres):  select * from private.cuentas_clientes;
