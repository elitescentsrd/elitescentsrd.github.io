// Base de datos de prueba que imita Supabase (roles anon/authenticated, auth.uid(), administrador y la tienda de hoy con
// 420 perfumes), con las migraciones de ofertas, cupones, protección de pedidos y encuesta ya aplicadas. La usan las
// pruebas de base de datos (PGlite: PostgreSQL embebido, sin tocar Supabase ni necesitar claves).
import { readFile } from 'node:fs/promises';

const PREVIAS = ['20260921121000_ofertas.sql', '20260921130000_cupones.sql', '20260922120000_proteccion_pedidos.sql', '20260923120000_encuesta.sql'];

export const BASE_SQL = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema private;
grant usage on schema private to authenticated;
create table public.admin_users (user_id uuid primary key);
create table public.customer_profiles (user_id uuid primary key, first_name text, last_name text, cedula text, phone text, address text);
create function private.is_store_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;
grant execute on function private.is_store_admin() to authenticated;
create table public.products (
  id bigint generated always as identity primary key, name text not null, price text not null default 'Precio a confirmar',
  size text not null default '' check (length(size) <= 60), gender text not null default 'unisex' check (gender in ('hombre','mujer','unisex')),
  page integer, slot integer, image_url text, sort_order integer not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  availability text not null default 'disponible' check (availability in ('disponible','agotado','encargo')),
  brand text not null default '', notes_top text[] not null default '{}', notes_heart text[] not null default '{}', notes_base text[] not null default '{}',
  gallery_urls text[] not null default '{}', description text not null default '',
  constraint products_notes_top_limit check (cardinality(notes_top) <= 12), constraint products_notes_heart_limit check (cardinality(notes_heart) <= 12),
  constraint products_notes_base_limit check (cardinality(notes_base) <= 12), constraint products_description_length check (length(description) <= 1200));
alter table public.products enable row level security;
grant select on public.products to anon; grant select, insert, update, delete on public.products to authenticated;
create policy "Read active catalogue" on public.products for select to anon using (active);
create policy "Admins read catalogue" on public.products for select to authenticated using ((select private.is_store_admin()));
create table public.orders (id bigint generated always as identity primary key, created_at timestamptz not null default now(), customer_name text, phone text,
  items text, amount text not null default '', status text not null default 'nuevo', notes text, user_id uuid, cedula text);
alter table public.orders enable row level security;
grant select, insert, update, delete on public.orders to authenticated;
create policy "Admins read orders" on public.orders for select to authenticated using ((select private.is_store_admin()));
create function public.place_customer_order(p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ begin return '{}'::jsonb; end $$;
revoke execute on function public.place_customer_order(jsonb) from public, anon;
-- Regla de siempre: RD$7,000 o más = «Solo por encargo» (salvo «Agotado»).
create function private.enforce_high_price_by_order() returns trigger language plpgsql set search_path = '' as $$
declare highest numeric;
begin
  select max(replace(replace(m[1], ',', ''), '.', '')::numeric) into highest from regexp_matches(new.price, '([0-9][0-9,.]*)', 'g') as m;
  if highest >= 7000 and new.availability is distinct from 'agotado' then new.availability := 'encargo'; end if;
  return new;
end $$;
create trigger products_high_price_by_order before insert or update of price, availability on public.products for each row execute function private.enforce_high_price_by_order();
-- La tienda de hoy: 420 perfumes (3 French Avenue con la marca incompleta).
insert into public.products (name, price, brand, sort_order, availability)
  select 'Perfume ' || g, 'RD$' || to_char(2000 + g * 10, 'FM999,999'), 'Marca', g - 1, case when g % 5 = 0 then 'agotado' else 'disponible' end from generate_series(1, 420) g;
update public.products set name = 'French Avenue Aether Extrait', brand = 'French' where id = 152;
update public.products set name = 'French Avenue Atlantis Extrait', brand = 'French' where id = 153;
update public.products set name = 'French Avenue Liquid Brun', brand = 'French' where id = 156;
update public.products set price = 'RD$7,500' where id in (7, 8);
`;

export async function nuevaBase(PGlite) {
  const db = new PGlite();
  await db.exec(BASE_SQL);
  for (const file of PREVIAS) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  return db;
}
