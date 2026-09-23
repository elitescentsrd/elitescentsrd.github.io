-- PROTECCIÓN DE PEDIDOS: límite automático por cuenta e interruptor de emergencia.
--
-- Qué hace:
--   * Límite por cuenta de cliente: como máximo 3 pedidos cada 10 minutos y 10 cada 24 horas desde la web.
--     Frena a un bot o a una persona que intente llenar el panel de pedidos falsos. Un cliente real casi nunca llega.
--   * Interruptor "Pausar pedidos por la web" (tabla store_settings): si te atacan con pedidos falsos, lo activas desde
--     el panel y nadie puede hacer pedidos por la web hasta que lo desactives. WhatsApp sigue funcionando.
--   * Los pedidos que registras tú desde el panel (administrador) y los que se crean desde el SQL Editor no tienen límite
--     ni se bloquean con la pausa.
--   * Funciona también con los pedidos con cupón: si un pedido se rechaza, el cupón no se gasta.
--
-- No toca la función place_customer_order ni los pedidos existentes. Es seguro ejecutarla más de una vez.
-- Requisito: la migración de administrador (private.is_store_admin).
--
-- Para deshacerla:
--   drop trigger if exists orders_protect_web_orders on public.orders;
--   drop function if exists private.protect_web_orders();

create schema if not exists private;

do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'No existe private.is_store_admin(): aplica antes la migración de administrador. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id') then
    raise exception 'La tabla orders no tiene user_id. No se cambió nada.';
  end if;
end $$;

-- 1) Ajustes de la tienda (una sola fila).
create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  orders_paused boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (true) on conflict (id) do nothing;

alter table public.store_settings enable row level security;
revoke all on public.store_settings from anon, authenticated;
grant select, update (orders_paused, updated_at) on public.store_settings to authenticated;
drop policy if exists "Admins leen ajustes de la tienda" on public.store_settings;
create policy "Admins leen ajustes de la tienda" on public.store_settings for select to authenticated
  using ((select private.is_store_admin()));
drop policy if exists "Admins cambian ajustes de la tienda" on public.store_settings;
create policy "Admins cambian ajustes de la tienda" on public.store_settings for update to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

-- 2) Límite y pausa, antes de guardar cada pedido.
create index if not exists orders_user_created on public.orders (user_id, created_at desc);

create or replace function private.protect_web_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_recent integer;
  v_day integer;
begin
  -- Sin sesión (SQL Editor, tareas internas) o administrador desde el panel: sin límite.
  if v_uid is null or (select private.is_store_admin()) then
    return new;
  end if;
  if coalesce((select s.orders_paused from public.store_settings s where s.id), false) then
    raise exception 'Los pedidos por la web están pausados por un momento. Escríbenos por WhatsApp al 809-433-3348 y te atendemos.' using errcode = 'P0001';
  end if;
  -- Dos pedidos de la misma cuenta al mismo tiempo esperan su turno, así ninguno se salta el conteo.
  perform pg_advisory_xact_lock(hashtextextended('elite-orders:' || v_uid::text, 0));
  select count(*) filter (where o.created_at > now() - interval '10 minutes'), count(*)
    into v_recent, v_day
    from public.orders o
   where o.user_id = v_uid and o.created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    raise exception 'Hiciste varios pedidos en pocos minutos. Espera un momento o escríbenos por WhatsApp al 809-433-3348.' using errcode = 'P0001';
  end if;
  if v_day >= 10 then
    raise exception 'Llegaste al máximo de pedidos por hoy desde la web. Escríbenos por WhatsApp al 809-433-3348 y te ayudamos.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_web_orders() from public, anon, authenticated;

drop trigger if exists orders_protect_web_orders on public.orders;
create trigger orders_protect_web_orders
before insert on public.orders
for each row execute function private.protect_web_orders();

-- Comprobación (debe devolver una fila con orders_paused = false):
--   select * from public.store_settings;
