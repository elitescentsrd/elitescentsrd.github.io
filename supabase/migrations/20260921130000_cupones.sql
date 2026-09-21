-- CUPONES DE DESCUENTO (eventos, primera compra, códigos para clientes).
--
-- Qué hace:
--   * Crea las tablas coupons (los cupones que tú administras desde el panel), coupon_redemptions (quién usó cada cupón)
--     y coupon_attempts (freno contra quien intenta adivinar códigos).
--   * preview_coupon(): el cliente escribe su código en el carrito y ve cuánto descuenta (solo con sesión iniciada).
--   * place_customer_order_con_cupon(): hace el pedido normal (llama a place_customer_order, que NO se modifica) y
--     enseguida aplica el descuento en la misma transacción. Si algo falla, no queda ni pedido ni cupón gastado.
--   * El descuento SIEMPRE lo calcula la base de datos sobre el total real del pedido: el navegador no puede inventarlo.
--   * Nadie sin sesión puede usar estas funciones, y los clientes no pueden ver la lista de cupones (solo administradores).
--
-- Es seguro ejecutarla más de una vez. No toca productos, precios ni pedidos existentes (solo agrega dos columnas a orders).
-- Requisitos: ya deben estar aplicadas las migraciones de "ofertas" y de administrador (private.is_store_admin).
--
-- Para deshacerla (deja los pedidos como están):
--   drop function if exists public.place_customer_order_con_cupon(jsonb, text);
--   drop function if exists public.preview_coupon(text, bigint[], numeric);
--   drop function if exists private.coupon_evaluate(uuid, text, bigint[], numeric, boolean, bigint);

create schema if not exists private;

-- 0) Comprobaciones previas: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('public.place_customer_order(jsonb)') is null then
    raise exception 'No existe public.place_customer_order(jsonb): los cupones se apoyan en ella. No se cambió nada.';
  end if;
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'No existe private.is_store_admin(): aplica antes la migración de administrador. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'original_price') then
    raise exception 'Falta la migración de ofertas (columna products.original_price). Aplícala primero. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id') then
    raise exception 'La tabla orders no tiene user_id. No se cambió nada.';
  end if;
end $$;

-- 1) Tablas
create table if not exists public.coupons (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,24}$'),
  description text not null default '' check (length(description) <= 120),
  kind text not null check (kind in ('percent', 'amount')),
  value numeric(12,2) not null check (value > 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount > 0),
  min_subtotal numeric(12,2) not null default 0 check (min_subtotal >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  one_per_customer boolean not null default true,
  first_order_only boolean not null default false,
  allow_with_offers boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint coupons_percent_range check (kind <> 'percent' or value <= 90),
  constraint coupons_dates_order check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table if not exists public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_code text not null references public.coupons (code) on update cascade on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  order_id bigint,
  discount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_code_user on public.coupon_redemptions (coupon_code, user_id);

create table if not exists public.coupon_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists coupon_attempts_user_time on public.coupon_attempts (user_id, attempted_at desc);

alter table public.orders
  add column if not exists coupon_code text,
  add column if not exists discount_amount numeric(12,2) not null default 0;

-- 2) Seguridad de las tablas: solo administradores (con verificación en dos pasos) leen y escriben cupones.
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.coupon_attempts enable row level security;

drop policy if exists "Admins gestionan cupones" on public.coupons;
create policy "Admins gestionan cupones" on public.coupons for all to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
drop policy if exists "Admins ven canjes de cupones" on public.coupon_redemptions;
create policy "Admins ven canjes de cupones" on public.coupon_redemptions for select to authenticated
  using ((select private.is_store_admin()));

revoke all on public.coupons, public.coupon_redemptions, public.coupon_attempts from anon, authenticated;
grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;

-- 3) Reglas del cupón (una sola función para la vista previa y para el pedido real).
--    p_subtotal null = todavía no se conoce el total (solo se revisan las reglas). p_exclude_order = el pedido recién creado.
create or replace function private.coupon_evaluate(
  p_uid uuid, p_code text, p_product_ids bigint[], p_subtotal numeric, p_record boolean default true, p_exclude_order bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_c public.coupons;
  v_recent integer;
  v_fail text;
  v_discount numeric;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu código de descuento.');
  end if;

  -- Freno: más de 8 códigos inexistentes en 10 minutos y se pausa la comprobación (evita adivinar códigos).
  select count(*) into v_recent from public.coupon_attempts where user_id = p_uid and attempted_at > now() - interval '10 minutes';
  if v_recent >= 8 then
    return jsonb_build_object('ok', false, 'message', 'Demasiados intentos. Espera unos minutos y vuelve a probar.');
  end if;

  select * into v_c from public.coupons where code = v_code;
  if not found then
    if p_record then
      insert into public.coupon_attempts (user_id) values (p_uid);
      delete from public.coupon_attempts where attempted_at < now() - interval '1 day';
    end if;
    return jsonb_build_object('ok', false, 'message', 'Ese código no existe o ya no es válido.');
  end if;

  v_fail := case
    when not v_c.active then 'Ese código no está activo.'
    when v_c.starts_at is not null and now() < v_c.starts_at then 'Este cupón todavía no ha empezado.'
    when v_c.ends_at is not null and now() >= v_c.ends_at then 'Este cupón ya venció.'
    when v_c.max_uses is not null and v_c.used_count >= v_c.max_uses then 'Este cupón ya alcanzó su límite de usos.'
    when v_c.one_per_customer and exists (select 1 from public.coupon_redemptions r where r.coupon_code = v_c.code and r.user_id = p_uid) then 'Ya usaste este cupón.'
    when v_c.first_order_only and exists (select 1 from public.orders o where o.user_id = p_uid and o.status <> 'cancelado' and o.id <> coalesce(p_exclude_order, -1)) then 'Este cupón es solo para tu primera compra.'
    when not v_c.allow_with_offers and exists (select 1 from public.products p where p.id = any (coalesce(p_product_ids, '{}'::bigint[])) and p.original_price is not null) then 'Este cupón no se combina con perfumes que ya están en oferta.'
    else null
  end;
  if v_fail is not null then
    return jsonb_build_object('ok', false, 'message', v_fail);
  end if;

  if p_subtotal is null then
    return jsonb_build_object('ok', true, 'code', v_c.code, 'description', v_c.description, 'kind', v_c.kind, 'value', v_c.value);
  end if;
  if p_subtotal < v_c.min_subtotal then
    return jsonb_build_object('ok', false, 'message', 'Este cupón requiere un pedido de al menos RD$' || to_char(v_c.min_subtotal, 'FM999,999,999') || '.');
  end if;

  v_discount := case when v_c.kind = 'percent' then round(p_subtotal * v_c.value / 100) else round(v_c.value) end;
  if v_c.max_discount is not null then v_discount := least(v_discount, round(v_c.max_discount)); end if;
  v_discount := least(v_discount, p_subtotal);
  return jsonb_build_object('ok', true, 'code', v_c.code, 'description', v_c.description, 'kind', v_c.kind, 'value', v_c.value,
                            'discount', v_discount, 'subtotal', p_subtotal, 'total', greatest(p_subtotal - v_discount, 0));
end;
$$;
revoke all on function private.coupon_evaluate(uuid, text, bigint[], numeric, boolean, bigint) from public, anon, authenticated;

-- 4) Vista previa en el carrito (informativa: el descuento definitivo se calcula al hacer el pedido).
create or replace function public.preview_coupon(p_code text, p_product_ids bigint[] default '{}', p_subtotal numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para usar un cupón.' using errcode = '28000';
  end if;
  return private.coupon_evaluate(v_uid, p_code, p_product_ids, greatest(coalesce(p_subtotal, 0), 0), true, null);
end;
$$;
revoke all on function public.preview_coupon(text, bigint[], numeric) from public, anon;
grant execute on function public.preview_coupon(text, bigint[], numeric) to authenticated;

-- 5) Pedido con cupón: crea el pedido con la función de siempre y aplica el descuento sobre su total real.
--    Sin código, es exactamente place_customer_order. Con un código que no sirve devuelve {ok:false, message} y NO crea nada.
create or replace function public.place_customer_order_con_cupon(p_items jsonb, p_coupon text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(trim(coalesce(p_coupon, '')));
  v_ids bigint[];
  v_check jsonb;
  v_res jsonb;
  v_order_id bigint;
  v_amount text;
  v_subtotal numeric;
  v_final jsonb;
  v_discount numeric;
  v_total numeric;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para ordenar.' using errcode = '28000';
  end if;

  if v_code = '' then
    execute 'select to_jsonb(public.place_customer_order($1))' into v_res using p_items;
    return v_res;
  end if;

  select coalesce(array_agg(distinct (i ->> 'product_id')::bigint), '{}'::bigint[]) into v_ids from jsonb_array_elements(p_items) i;

  -- Bloquea la fila del cupón: dos pedidos a la vez no pueden pasarse del máximo de usos.
  perform 1 from public.coupons where code = v_code for update;
  v_check := private.coupon_evaluate(v_uid, v_code, v_ids, null, true, null);
  if not coalesce((v_check ->> 'ok')::boolean, false) then
    return v_check;
  end if;

  execute 'select to_jsonb(public.place_customer_order($1))' into v_res using p_items;
  if jsonb_typeof(v_res) is distinct from 'object' then
    v_res := jsonb_build_object('order_id', v_res);
  end if;
  v_order_id := nullif(v_res ->> 'order_id', '')::bigint;
  if v_order_id is null then
    select o.id into v_order_id from public.orders o where o.user_id = v_uid order by o.id desc limit 1;
  end if;

  select o.amount into v_amount from public.orders o where o.id = v_order_id and o.user_id = v_uid;
  v_subtotal := nullif(replace(coalesce((regexp_match(v_amount, '([0-9][0-9,]*(?:\.[0-9]+)?)'))[1], ''), ',', ''), '')::numeric;
  if v_subtotal is null or v_subtotal <= 0 then
    raise exception 'No se pudo calcular el total del pedido para aplicar el cupón. Haz el pedido sin cupón o consúltanos por WhatsApp.';
  end if;

  v_final := private.coupon_evaluate(v_uid, v_code, v_ids, v_subtotal, false, v_order_id);
  if not coalesce((v_final ->> 'ok')::boolean, false) then
    -- Al lanzar el error se deshace también el pedido recién creado: el cliente puede reintentar sin cupón.
    raise exception '%', v_final ->> 'message';
  end if;

  v_discount := (v_final ->> 'discount')::numeric;
  v_total := greatest(v_subtotal - v_discount, 0);
  update public.orders
     set amount = 'RD$' || to_char(v_total, 'FM999,999,999'),
         coupon_code = v_code,
         discount_amount = v_discount,
         notes = left(trim(coalesce(notes, '') || ' Cupón ' || v_code || ': -RD$' || to_char(v_discount, 'FM999,999,999') || ' sobre RD$' || to_char(v_subtotal, 'FM999,999,999') || '.'), 2000)
   where id = v_order_id;
  insert into public.coupon_redemptions (coupon_code, user_id, order_id, discount) values (v_code, v_uid, v_order_id, v_discount);
  update public.coupons set used_count = used_count + 1 where code = v_code;

  return v_res || jsonb_build_object('cupon', v_code, 'descuento', v_discount, 'subtotal', v_subtotal, 'total', v_total);
end;
$$;
revoke all on function public.place_customer_order_con_cupon(jsonb, text) from public, anon;
grant execute on function public.place_customer_order_con_cupon(jsonb, text) to authenticated;

-- Comprobación desde el SQL Editor (rol postgres): debe listar los tres objetos.
--   select to_regclass('public.coupons'), to_regprocedure('public.preview_coupon(text,bigint[],numeric)'),
--          to_regprocedure('public.place_customer_order_con_cupon(jsonb,text)');
