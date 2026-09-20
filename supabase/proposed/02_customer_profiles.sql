-- PROPUESTA — revisar antes de ejecutar.
-- Reconstruida a partir de customer.js: lee/escribe
-- /rest/v1/customer_profiles?select=*&user_id=eq.<uid> con los campos
-- first_name, last_name, cedula, phone, address, updated_at. No existe en
-- ningún archivo de supabase/*.sql versionado.

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '' check (length(first_name) <= 80),
  last_name text not null default '' check (length(last_name) <= 120),
  cedula text not null default '' check (length(cedula) <= 30),
  phone text not null default '' check (length(phone) <= 40),
  address text not null default '' check (length(address) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
revoke all on table public.customer_profiles from anon;

-- Cada cliente autenticado solo puede ver/editar su propio perfil.
drop policy if exists "Customers manage own profile" on public.customer_profiles;
create policy "Customers manage own profile"
on public.customer_profiles for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Los administradores también pueden leerlos (para atender pedidos).
drop policy if exists "Admins read customer profiles" on public.customer_profiles;
create policy "Admins read customer profiles"
on public.customer_profiles for select to authenticated
using ((select private.is_store_admin()));

grant select, insert, update on table public.customer_profiles to authenticated;

revoke all on function private.touch_updated_at() from public, anon;
grant execute on function private.touch_updated_at() to authenticated;
drop trigger if exists customer_profiles_touch_updated_at on public.customer_profiles;
create trigger customer_profiles_touch_updated_at
before update on public.customer_profiles
for each row execute function private.touch_updated_at();
