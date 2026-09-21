-- EXIGIR MFA A LOS ADMINISTRADORES EN LA BASE DE DATOS (no solo en la pantalla del panel).
--
-- NO EJECUTAR HASTA QUE TU CUENTA DE ADMINISTRADOR YA TENGA MFA ACTIVADO. Orden:
--   1. Publica la versión del panel con verificación en dos pasos (ya incluida en la rama).
--   2. Entra a /admin.html: te obligará a escanear el QR y a confirmar un código. Ya tienes MFA.
--   3. Sal y vuelve a entrar: debe pedirte el código. Si lo pide y entras, ejecuta esto.
--
-- Qué hace: todas las reglas de seguridad de administrador (productos, pedidos, perfiles de clientes, fotos en Storage,
-- cuentas de clientes) pasan por private.is_store_admin(). Con este cambio esa función solo devuelve true si la sesión
-- es AAL2, es decir, si la persona ya verificó el código de su app. Un atacante con solo la contraseña pasa a ser
-- rechazado por la propia base de datos.
--
-- Riesgo: si ejecutas esto ANTES de activar MFA en tu cuenta, dejarás de poder administrar hasta revertirlo.
-- Para revertirlo (siempre funciona desde el SQL Editor, que no usa tu sesión de administrador):
--   create or replace function private.is_store_admin() returns boolean language sql stable security definer set search_path = ''
--   as $f$ select exists(select 1 from public.admin_users where user_id = (select auth.uid())) $f$;

create or replace function private.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()))
     and coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
$$;

revoke all on function private.is_store_admin() from public, anon;
grant execute on function private.is_store_admin() to authenticated;
