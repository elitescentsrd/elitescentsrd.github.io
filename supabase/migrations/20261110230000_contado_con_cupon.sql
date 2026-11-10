-- PRECIO DE CONTADO EN LA WEB — 10 de noviembre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   La página muestra y cobra solo el precio de contado (10% menos que el precio guardado, que es el de dos pagos: ese
--   la tienda lo da por WhatsApp a quien conoce). Este archivo deja que el pedido de contado lleve cupón: la base de
--   datos calcula el total de contado con el precio de cada perfume y le descuenta el cupón (el mismo cupón que el
--   cliente ve en el carrito). No cambia precios.
--
-- Necesita antes 20261110200000_dos_precios.sql (ya aplicado).
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- PRECIO DE CONTADO EN LA WEB» y la última dice «-- FIN».
--
-- Es seguro repetirlo. Para volver atrás, aplica otra vez 20261110200000_dos_precios.sql (deja la función como antes y
-- no toca los precios que ya estén puestos).

do $$
begin
  if to_regprocedure('public.place_customer_order_pago(jsonb,text,text)') is null or to_regprocedure('private.precio_contado(numeric)') is null then
    raise exception 'Primero aplica 20261110200000_dos_precios.sql. No se cambió nada.';
  end if;
  if to_regprocedure('private.coupon_evaluate(uuid,text,bigint[],numeric,boolean,bigint)') is null then
    raise exception 'Falta la migración de cupones (20260921130000_cupones.sql). No se cambió nada.';
  end if;
end $$;

create or replace function public.place_customer_order_pago(p_items jsonb, p_coupon text default null, p_plan text default 'contado')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan text := lower(btrim(coalesce(p_plan, 'contado')));
  v_code text := upper(btrim(coalesce(p_coupon, '')));
  v_ids bigint[];
  v_check jsonb;
  v_final jsonb;
  v_res jsonb;
  v_order_id bigint;
  v_amount text;
  v_list numeric;
  v_total numeric;
  v_discount numeric := 0;
  v_lines integer;
  v_missing integer;
  v_first numeric;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para ordenar.' using errcode = '28000';
  end if;
  if v_plan not in ('contado', 'dos_pagos') then
    raise exception 'Forma de pago no válida.';
  end if;

  -- A dos pagos (solo si la tienda lo usa): como antes, con la función del cupón si hay.
  if v_plan = 'dos_pagos' then
    if v_code <> '' then
      v_res := public.place_customer_order_con_cupon(p_items, v_code);
      if jsonb_typeof(v_res) = 'object' and (v_res ->> 'ok') = 'false' then return v_res; end if;
    else
      execute 'select to_jsonb(public.place_customer_order($1))' into v_res using p_items;
    end if;
  else
    -- Contado: el cupón se revisa antes de registrar el pedido (y se aparta para que dos pedidos a la vez no se pasen
    -- del máximo de usos); el descuento se calcula después, sobre el total de contado.
    if v_code <> '' then
      select coalesce(array_agg(distinct (i ->> 'product_id')::bigint), '{}'::bigint[]) into v_ids from jsonb_array_elements(p_items) i;
      perform 1 from public.coupons where code = v_code for update;
      v_check := private.coupon_evaluate(v_uid, v_code, v_ids, null, true, null);
      if not coalesce((v_check ->> 'ok')::boolean, false) then
        return v_check;
      end if;
    end if;
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

  if v_plan = 'dos_pagos' then
    v_total := v_list;
    v_first := ceil(coalesce(v_total, 0) / 2);
    update public.orders
       set payment_plan = 'dos_pagos',
           notes = left(btrim(coalesce(notes, '') || ' A DOS PAGOS: RD$' || to_char(v_first, 'FM999,999,999') ||
                   ' al recibir y RD$' || to_char(coalesce(v_total, 0) - v_first, 'FM999,999,999') || ' en 15 días.'), 2000)
     where id = v_order_id;
    return v_res || jsonb_build_object('order_id', v_order_id, 'pago', v_plan, 'total', v_total);
  end if;

  -- Total de contado con el precio de cada perfume en la base (líneas del pedido); en oferta, el precio de oferta.
  select count(*), count(*) filter (where i.unit_price is null or i.product_id is null),
         sum(case when p.original_price is not null then i.unit_price else private.precio_contado(i.unit_price) end * i.qty)
    into v_lines, v_missing, v_total
    from public.order_items i left join public.products p on p.id = i.product_id
   where i.order_id = v_order_id;
  if v_lines = 0 or v_missing > 0 or v_total is null or v_total <= 0 or (v_list is not null and v_total > v_list) then
    if v_code <> '' then
      -- Al lanzar el error se deshace el pedido: el cliente puede reintentar sin cupón.
      raise exception 'No se pudo calcular el precio de contado de tu pedido con el cupón. Haz el pedido sin cupón o escríbenos por WhatsApp.';
    end if;
    update public.orders
       set payment_plan = 'contado',
           notes = left(btrim(coalesce(notes, '') || ' CONTADO: confirma el precio de contado con el cliente (algún perfume no se reconoció).'), 2000)
     where id = v_order_id;
    return v_res || jsonb_build_object('order_id', v_order_id, 'pago', 'contado', 'total', v_list);
  end if;

  if v_code <> '' then
    v_final := private.coupon_evaluate(v_uid, v_code, v_ids, v_total, false, v_order_id);
    if not coalesce((v_final ->> 'ok')::boolean, false) then
      raise exception '%', v_final ->> 'message';
    end if;
    v_discount := coalesce((v_final ->> 'discount')::numeric, 0);
    insert into public.coupon_redemptions (coupon_code, user_id, order_id, discount) values (v_code, v_uid, v_order_id, v_discount);
    update public.coupons set used_count = used_count + 1 where code = v_code;
  end if;

  update public.orders
     set amount = 'RD$' || to_char(greatest(v_total - v_discount, 0), 'FM999,999,999'),
         payment_plan = 'contado',
         coupon_code = case when v_code <> '' then v_code else coupon_code end,
         discount_amount = case when v_code <> '' then v_discount else discount_amount end,
         notes = left(btrim(coalesce(notes, '') || ' CONTADO: RD$' || to_char(v_total, 'FM999,999,999') ||
                 case when v_code <> '' then ' − cupón ' || v_code || ' RD$' || to_char(v_discount, 'FM999,999,999') || ' = RD$' || to_char(greatest(v_total - v_discount, 0), 'FM999,999,999') else '' end ||
                 ' (a dos pagos sería ' || coalesce(v_amount, '') || ').'), 2000)
   where id = v_order_id;

  return v_res || jsonb_build_object('order_id', v_order_id, 'pago', 'contado', 'subtotal', v_total, 'total', greatest(v_total - v_discount, 0)) ||
         case when v_code <> '' then jsonb_build_object('cupon', v_code, 'descuento', v_discount) else '{}'::jsonb end;
end;
$$;
revoke all on function public.place_customer_order_pago(jsonb, text, text) from public, anon;
grant execute on function public.place_customer_order_pago(jsonb, text, text) to authenticated;

select 'Pedidos de la web: precio de contado (con cupón si lo trae)' as cambio, 'listo' as estado;

-- FIN
