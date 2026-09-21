-- RECUPERACIÓN DE CUENTA: comprobación adicional de identidad (últimos 4 dígitos de la cédula registrada).
--
-- El correo con el enlace de recuperación demuestra que quien pide el cambio controla el buzón de la cuenta. Esta función
-- añade una segunda comprobación: al abrir el enlace, la web pide los últimos 4 dígitos de la cédula que el cliente
-- guardó en su perfil y llama a esta función antes de permitir escribir la nueva contraseña.
--
--   verify_recovery_identity('')      -> 'need' (el perfil tiene cédula), 'no_profile' (no hay cédula que comprobar) o 'locked'
--   verify_recovery_identity('1234')  -> 'ok', 'bad', 'locked' o 'no_profile'
--
-- Límite: 5 fallos cada 30 minutos por cuenta (no se evita creando otra sesión). No devuelve nunca la cédula.
-- Aviso honesto: la web exige esta comprobación, pero el cambio de contraseña lo ejecuta Supabase Auth; para quien
-- domine la API la barrera real es el enlace del correo (un solo uso, corta duración) y el código MFA si la cuenta lo tiene.

create schema if not exists private;

create table if not exists private.recovery_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists recovery_attempts_user_at on private.recovery_attempts(user_id, at desc);
revoke all on table private.recovery_attempts from public, anon, authenticated;

create or replace function public.verify_recovery_identity(p_last4 text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  digits  text;
  wanted  text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
  fails   integer;
begin
  if uid is null then
    return 'no_session';
  end if;
  delete from private.recovery_attempts where at < now() - interval '1 day';
  select count(*) into fails from private.recovery_attempts where user_id = uid and at > now() - interval '30 minutes';
  if fails >= 5 then
    return 'locked';
  end if;
  select regexp_replace(coalesce(cedula, ''), '\D', '', 'g') into digits from public.customer_profiles where user_id = uid;
  if digits is null or length(digits) < 4 then
    return 'no_profile';
  end if;
  if wanted = '' then
    return 'need';
  end if;
  if right(digits, 4) = right(wanted, 4) and length(wanted) = 4 then
    delete from private.recovery_attempts where user_id = uid;
    return 'ok';
  end if;
  insert into private.recovery_attempts(user_id) values (uid);
  return 'bad';
end;
$$;

revoke all on function public.verify_recovery_identity(text) from public, anon;
grant execute on function public.verify_recovery_identity(text) to authenticated;
