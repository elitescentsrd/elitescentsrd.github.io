-- SOLO REFERENCIA — NO EJECUTAR SIN ANTES VERIFICAR SI LA FUNCIÓN YA EXISTE.
--
-- En el SQL Editor de Supabase, ejecuta primero:
--   select prosrc from pg_proc where proname = 'place_customer_order';
-- Si devuelve una fila, la función real ya existe (la auditoría anterior
-- confirmó que valida auth.uid() y recalcula el precio en servidor) y
-- probablemente es mejor que esta plantilla — no la reemplaces a ciegas.
-- Esto es solo una reconstrucción a partir de cómo la llama customer.js:
--   authFetch('/rest/v1/rpc/place_customer_order', {
--     method: 'POST',
--     body: JSON.stringify({ p_items: [{product_id, qty, unit_price, size}, ...] })
--   })
-- unit_price viaja desde el navegador pero esta plantilla lo IGNORA a
-- propósito y vuelve a leer products.price desde la base, que es la parte de
-- seguridad más importante (nunca confiar en el precio que envía el cliente).

create or replace function public.place_customer_order(p_items jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.customer_profiles;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_line_total numeric;
  v_total numeric := 0;
  v_items_text text := '';
  v_order public.orders;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para pedir.' using errcode = '28000';
  end if;

  select * into v_profile from public.customer_profiles where user_id = v_uid;
  if v_profile is null or v_profile.cedula = '' or v_profile.phone = '' or v_profile.address = '' then
    raise exception 'Completa tu perfil (cédula, teléfono y dirección) antes de pedir.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::bigint and active;

    if v_product is null then
      raise exception 'Uno de los productos ya no está disponible.';
    end if;

    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));
    -- Recalcula el precio desde la base; nunca confía en unit_price del cliente.
    v_line_total := coalesce((regexp_match(v_product.price, '([0-9][0-9,.]*)'))[1]::numeric, 0)
                    * v_qty;
    v_total := v_total + v_line_total;
    v_items_text := v_items_text || v_qty || 'x ' || v_product.name
                    || case when v_item->>'size' is not null and v_item->>'size' <> ''
                            then ' (' || (v_item->>'size') || ')' else '' end
                    || E'\n';
  end loop;

  insert into public.orders (customer_name, phone, items, amount, status, notes, cedula, shipping_address)
  values (
    trim(v_profile.first_name || ' ' || v_profile.last_name),
    v_profile.phone,
    trim(v_items_text),
    'RD$' || to_char(v_total, 'FM999,999,999'),
    'nuevo',
    'Pedido creado desde la cuenta del cliente (user_id: ' || v_uid || ').',
    v_profile.cedula,
    v_profile.address
  )
  returning * into v_order;

  return v_order;
end;
$$;

revoke execute on function public.place_customer_order(jsonb) from public, anon;
grant execute on function public.place_customer_order(jsonb) to authenticated;
