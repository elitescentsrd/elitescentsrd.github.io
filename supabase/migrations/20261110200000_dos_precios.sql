-- DOS PRECIOS: CONTADO Y A DOS PAGOS — 10 de noviembre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Los pedidos de la web guardan la forma de pago que eligió el cliente en el carrito (columna orders.payment_plan):
--      «a dos pagos» (el precio del catálogo: la mitad al recibir y la otra mitad en 15 días) o «contado» (10% menos,
--      terminado en 50, como lo muestra la página). La función place_customer_order_pago registra el pedido con la
--      función de siempre (y el cupón, si hay) y, si es de contado, la base de datos calcula el total con el precio de
--      cada perfume (nunca con el que manda el navegador). Los perfumes en oferta no llevan el descuento de contado, y
--      los cupones son solo para compras a dos pagos.
--   2. Ajusta el precio de 4 perfumes: Set De Asad Bourbon, Moschino Toy Boy, Rayhaan Elixir y Rayhaan Tropical Vibe.
--
-- Lo que cambiaste a mano en el panel se respeta: un precio solo se cambia si sigue igual al de hoy.
-- Mientras no apliques este archivo la página sigue funcionando: el cliente elige la forma de pago y esta va en el
-- mensaje de WhatsApp del pedido.
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- DOS PRECIOS: CONTADO Y A DOS PAGOS» y la última dice «-- FIN».
--
-- Es seguro repetirlo: lo que ya está hecho no se repite.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo. Devuelve los 4 precios
-- (solo si siguen siendo los que puso este archivo) y quita la función de la forma de pago (la página vuelve a anotar
-- la forma de pago solo en el mensaje de WhatsApp). La columna payment_plan se queda con lo que ya se anotó.

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'No existe private.is_store_admin(): aplica antes la migración de administrador. No se cambió nada.';
  end if;
  if to_regprocedure('public.place_customer_order(jsonb)') is null then
    raise exception 'No existe la función de pedidos place_customer_order. No se cambió nada.';
  end if;
  if to_regprocedure('public.place_customer_order_con_cupon(jsonb,text)') is null then
    raise exception 'Falta la migración de cupones (20260921130000_cupones.sql). No se cambió nada.';
  end if;
  if to_regclass('public.order_items') is null then
    raise exception 'Falta la migración de líneas de pedido (20261003180000_lineas_de_pedido_y_existencias.sql). No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'original_price') then
    raise exception 'Falta la migración de ofertas (20260921121000_ofertas.sql). No se cambió nada.';
  end if;
end $$;

-- 0b) Turno: aparta los perfumes antes de empezar (unos segundos), sin quedarse esperando mientras tiene algo
--     apartado. Así no choca con un cliente que esté comprando en ese momento («deadlock detected»): si alguien los
--     está usando, suelta todo, espera un instante y vuelve a intentar.
do $$
begin
  for intento in 1..80 loop
    begin
      lock table public.products in share row exclusive mode nowait;
      return;
    exception when lock_not_available then
      perform pg_sleep(0.25);
    end;
  end loop;
  raise exception 'La tienda está muy ocupada en este momento. Espera un minuto y vuelve a darle Run. No se cambió nada.';
end $$;

create temp table modo on commit drop as select false as deshacer;  -- ← DESHACER: cambia false por true
create temp table resumen (orden int, cambio text, hechos_ahora bigint, ya_estaban bigint, total bigint) on commit drop;

-- 1) Forma de pago de cada pedido.
alter table public.orders add column if not exists payment_plan text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_plan_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_payment_plan_check check (payment_plan is null or payment_plan in ('contado', 'dos_pagos'));
  end if;
end $$;

-- Precio de contado de un monto: 10% menos, terminado en 50 (el mismo cálculo que pagos.js en la página).
create or replace function private.precio_contado(p_amount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((p_amount * 0.9 - 50) / 100) * 100 + 50;
$$;
revoke all on function private.precio_contado(numeric) from public, anon, authenticated;

create or replace function public.place_customer_order_pago(p_items jsonb, p_coupon text default null, p_plan text default 'dos_pagos')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan text := lower(btrim(coalesce(p_plan, 'dos_pagos')));
  v_code text := upper(btrim(coalesce(p_coupon, '')));
  v_res jsonb;
  v_order_id bigint;
  v_amount text;
  v_list numeric;
  v_total numeric;
  v_lines integer;
  v_missing integer;
  v_first numeric;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para ordenar.' using errcode = '28000';
  end if;
  if v_plan not in ('contado', 'dos_pagos') then
    raise exception 'Elige la forma de pago: contado o a dos pagos.';
  end if;
  if v_plan = 'contado' and v_code <> '' then
    return jsonb_build_object('ok', false, 'message', 'Los cupones son para compras a dos pagos: el precio de contado ya trae su descuento.');
  end if;

  -- El pedido se registra con las funciones de siempre (validan la sesión, el perfil y los precios; el cupón, si hay).
  if v_code <> '' then
    v_res := public.place_customer_order_con_cupon(p_items, v_code);
    if jsonb_typeof(v_res) = 'object' and (v_res ->> 'ok') = 'false' then
      return v_res;
    end if;
  else
    execute 'select to_jsonb(public.place_customer_order($1))' into v_res using p_items;
  end if;
  if jsonb_typeof(v_res) is distinct from 'object' then
    v_res := jsonb_build_object('order_id', v_res);
  end if;
  v_order_id := nullif(coalesce(v_res ->> 'order_id', v_res ->> 'id'), '')::bigint;
  if v_order_id is null then
    select o.id into v_order_id from public.orders o where o.user_id = v_uid order by o.id desc limit 1;
  end if;
  select o.amount into v_amount from public.orders o where o.id = v_order_id and o.user_id = v_uid;
  if not found then
    raise exception 'No se pudo registrar el pedido. Inténtalo de nuevo o escríbenos por WhatsApp.';
  end if;
  v_list := nullif(replace(coalesce((regexp_match(v_amount, '([0-9][0-9,]*(?:\.[0-9]+)?)'))[1], ''), ',', ''), '')::numeric;

  if v_plan = 'contado' then
    -- Total de contado con el precio de cada perfume en la base (líneas del pedido); en oferta, el precio de oferta.
    select count(*), count(*) filter (where i.unit_price is null or i.product_id is null),
           sum(case when p.original_price is not null then i.unit_price else private.precio_contado(i.unit_price) end * i.qty)
      into v_lines, v_missing, v_total
      from public.order_items i left join public.products p on p.id = i.product_id
     where i.order_id = v_order_id;
    if v_lines = 0 or v_missing > 0 or v_total is null or v_total <= 0 or (v_list is not null and v_total > v_list) then
      -- No se reconoció algún perfume del pedido: queda con el total de siempre y la tienda confirma el de contado.
      update public.orders
         set payment_plan = 'contado',
             notes = left(btrim(coalesce(notes, '') || ' Pidió pagar de CONTADO: confirma el precio de contado con el cliente.'), 2000)
       where id = v_order_id;
      v_total := v_list;
    else
      update public.orders
         set amount = 'RD$' || to_char(v_total, 'FM999,999,999'),
             payment_plan = 'contado',
             notes = left(btrim(coalesce(notes, '') || ' Pago de CONTADO: RD$' || to_char(v_total, 'FM999,999,999') ||
                     ' (a dos pagos sería ' || coalesce(v_amount, '') || ').'), 2000)
       where id = v_order_id;
    end if;
  else
    v_total := v_list;
    v_first := ceil(coalesce(v_total, 0) / 2);
    update public.orders
       set payment_plan = 'dos_pagos',
           notes = left(btrim(coalesce(notes, '') || ' A DOS PAGOS: RD$' || to_char(v_first, 'FM999,999,999') ||
                   ' al recibir y RD$' || to_char(coalesce(v_total, 0) - v_first, 'FM999,999,999') || ' en 15 días.'), 2000)
     where id = v_order_id;
  end if;

  return v_res || jsonb_build_object('order_id', v_order_id, 'pago', v_plan, 'total', v_total);
end;
$$;
revoke all on function public.place_customer_order_pago(jsonb, text, text) from public, anon;
grant execute on function public.place_customer_order_pago(jsonb, text, text) to authenticated;

insert into resumen
select 1, 'Forma de pago en los pedidos (contado o a dos pagos)', 1, 0, 1 from modo m where not m.deshacer;

-- Deshacer: sin la función, la página vuelve a anotar la forma de pago solo en el mensaje de WhatsApp.
do $$
begin
  if (select deshacer from modo) then
    drop function if exists public.place_customer_order_pago(jsonb, text, text);
  end if;
end $$;
insert into resumen
select 1, 'Deshacer: función de forma de pago quitada', 1, 0, 1 from modo m where m.deshacer;

-- 2) Precios que cambian. «antes» es el precio de hoy en tu tienda; si dice otra cosa (lo cambiaste en el panel),
--    ese perfume no se toca.
create temp table cambios (
  id bigint primary key, nombre text not null, antes text not null, ahora text not null
) on commit drop;
insert into cambios (id, nombre, antes, ahora) values
  (295, 'Moschino Toy Boy', 'RD$5,250', 'RD$5,450'),
  (327, 'Rayhaan Elixir', 'RD$3,550', 'RD$4,950'),
  (369, 'Set De Asad Bourbon', 'RD$3,850', 'RD$3,950'),
  (456, 'Rayhaan Tropical Vibe', 'RD$4,450', 'RD$4,950');

with hechos as (
  update public.products p
     set price = c.ahora, updated_at = now()
    from cambios c, modo m
   where not m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre)
     and p.price = c.antes and p.original_price is null
  returning p.id
)
insert into resumen
select 2, 'Precios que suben', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where not m.deshacer and p.price = c.ahora and p.original_price is null),
       (select count(*) from cambios, modo m where not m.deshacer);

with hechos as (
  update public.products p
     set price = c.antes, updated_at = now()
    from cambios c, modo m
   where m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre) and p.price = c.ahora and p.original_price is null
  returning p.id
)
insert into resumen
select 2, 'Precios devueltos a como estaban (deshacer)', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where m.deshacer and p.price = c.antes and p.original_price is null),
       (select count(*) from cambios, modo m where m.deshacer);

-- 3) Resultado. «sin_cambiar» = perfumes que no se tocaron; debajo dice cuáles y por qué.
select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total
  from (
    select orden, cambio, hechos_ahora, ya_estaban, total from resumen
    union all
    select 3, 'No se tocó #' || c.id || ' ' || c.nombre || ': ' ||
              case when p.id is null then 'ya no está en tu tienda'
                   when lower(p.name) <> lower(c.nombre) then 'en tu tienda se llama «' || p.name || '»'
                   when p.original_price is not null then 'tiene una oferta puesta (' || p.price || ', antes ' || p.original_price || ')'
                   else 'en tu tienda dice ' || p.price || ' y este archivo esperaba ' || case when m.deshacer then c.ahora else c.antes end end,
           null, null, null
      from cambios c left join public.products p using (id), modo m
     where p.id is null or lower(p.name) <> lower(c.nombre) or p.original_price is not null
        or p.price not in (c.antes, c.ahora)
  ) r
 order by orden, cambio;

-- La primera vez verás «hechos_ahora» en los precios. Si lo repites: todo en «ya_estaban».
-- FIN
