-- FUNCIONES NUEVAS Y PERFUMES NUEVOS — 30 de septiembre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. «Inspirado en…»: columna products.inspired_by (el perfume de referencia; se ve en la tienda y se puede buscar).
--   2. «Avísame cuando llegue»: tabla restock_alerts y función request_restock_alert. La tienda la usa sin sesión,
--      con límites: número dominicano válido, sin repetir el mismo aviso y como máximo 5 avisos por hora por conexión.
--   3. «Lo más vendido»: función best_sellers. Devuelve solo números de perfume (nunca pedidos, montos ni clientes).
--   4. Abonos: tabla order_payments (lo que te paga cada cliente por pedido). Solo administradores.
--   5. Costos privados: tabla product_costs y ajustes de la fórmula de precios. Solo administradores.
--      Este archivo NO trae costos: se cargan aparte, desde el archivo privado que no está en GitHub.
--   6. 76 perfumes nuevos del catálogo de La Grada de septiembre (números 421 a 496) con precio,
--      marca, notas y foto. Los de RD$7,000 o más quedan «Solo por encargo» (regla automática de siempre).
--   7. «Inspirado en…» de 28 perfumes con referencia verificada (fuentes en data/inspirado-en.json).
--   8. Marca «French Avenue» completa en 3 perfumes que decían solo «French».
--
-- Requisitos: migraciones de administrador, ofertas, protección de pedidos y encuesta (ya aplicadas).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este archivo → Run.
-- Comprueba que pegaste todo: la primera línea empieza con «-- FUNCIONES NUEVAS Y PERFUMES NUEVOS» y la última
-- dice «-- FIN». Al final verás una tabla con lo que se hizo.
--
-- Es seguro repetirlo: lo que ya existe no se duplica y lo que cambiaste a mano en el panel no se toca.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo. Quita los perfumes
-- nuevos (los que siguen con el mismo nombre), las referencias «Inspirado en» de este archivo y la marca corregida.
-- Las tablas y funciones nuevas se quedan (vacías no afectan en nada).

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'No existe private.is_store_admin(): aplica antes la migración de administrador. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'original_price') then
    raise exception 'Falta la migración de ofertas (20260921121000_ofertas.sql). No se cambió nada.';
  end if;
  if to_regclass('public.store_settings') is null then
    raise exception 'Falta la migración de protección de pedidos (20260922120000_proteccion_pedidos.sql). No se cambió nada.';
  end if;
  if to_regprocedure('private.request_ip_hash()') is null then
    raise exception 'Falta la migración de la encuesta (20260923120000_encuesta.sql). No se cambió nada.';
  end if;
end $$;

-- 0b) Turno: aparta los perfumes, los ajustes y los pedidos antes de empezar (unos segundos), sin quedarse
--     esperando mientras tiene algo apartado. Así no choca con un cliente que esté comprando en ese momento
--     («deadlock detected»): si alguien los está usando, suelta todo, espera un instante y vuelve a intentar.
do $$
begin
  for intento in 1..80 loop
    begin
      lock table public.products, public.store_settings in access exclusive mode nowait;
      lock table public.orders in share row exclusive mode nowait;
      return;
    exception when lock_not_available then
      perform pg_sleep(0.25);
    end;
  end loop;
  raise exception 'La tienda está muy ocupada en este momento. Espera un minuto y vuelve a darle Run. No se cambió nada.';
end $$;

-- 1) «Inspirado en…» (lo ve todo el mundo, igual que el nombre y el precio).
alter table public.products add column if not exists inspired_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_inspired_by_length') then
    alter table public.products add constraint products_inspired_by_length check (inspired_by is null or length(inspired_by) between 2 and 120);
  end if;
end $$;

-- 2) «Avísame cuando llegue».
create table if not exists public.restock_alerts (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id) on delete cascade,
  customer_name text not null check (length(customer_name) between 2 and 80),
  phone text not null check (phone ~ '^(809|829|849)[0-9]{7}$'),
  status text not null default 'pendiente' check (status in ('pendiente', 'avisado')),
  ip_hash text,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists restock_alerts_pending_once on public.restock_alerts (product_id, phone) where status = 'pendiente';
create index if not exists restock_alerts_ip_time on public.restock_alerts (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists restock_alerts_created on public.restock_alerts (created_at desc);
alter table public.restock_alerts enable row level security;
revoke all on public.restock_alerts from anon, authenticated;
grant select, delete on public.restock_alerts to authenticated;
grant update (status, notified_at) on public.restock_alerts to authenticated;
drop policy if exists "Admins leen avisos de reposicion" on public.restock_alerts;
create policy "Admins leen avisos de reposicion" on public.restock_alerts for select to authenticated
  using ((select private.is_store_admin()));
drop policy if exists "Admins marcan avisos de reposicion" on public.restock_alerts;
create policy "Admins marcan avisos de reposicion" on public.restock_alerts for update to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
drop policy if exists "Admins borran avisos de reposicion" on public.restock_alerts;
create policy "Admins borran avisos de reposicion" on public.restock_alerts for delete to authenticated
  using ((select private.is_store_admin()));

create or replace function public.request_restock_alert(p_product_id bigint, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_ip text := private.request_ip_hash();
  v_product public.products;
  v_count integer;
begin
  if length(v_phone) = 11 and left(v_phone, 1) = '1' then
    v_phone := substr(v_phone, 2);
  end if;
  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[<>{}]' then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu nombre (de 2 a 80 letras).');
  end if;
  if v_phone !~ '^(809|829|849)[0-9]{7}$' then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu WhatsApp dominicano de 10 dígitos (809, 829 u 849).');
  end if;
  select * into v_product from public.products where id = p_product_id and active;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Ese perfume ya no está en la tienda.');
  end if;
  if v_product.availability not in ('agotado', 'encargo') then
    return jsonb_build_object('ok', false, 'message', 'Este perfume ya está disponible: puedes pedirlo ahora mismo.');
  end if;
  if exists (select 1 from public.restock_alerts a where a.product_id = p_product_id and a.phone = v_phone and a.status = 'pendiente') then
    return jsonb_build_object('ok', true, 'already', true, 'message', 'Ya estás en la lista: te escribiremos por WhatsApp cuando llegue.');
  end if;
  -- Dos solicitudes de la misma conexión a la vez esperan su turno: así nadie se salta los límites.
  perform pg_advisory_xact_lock(hashtextextended('elite-restock:' || coalesce(v_ip, 'sin-conexion'), 0));
  if v_ip is not null then
    select count(*) into v_count from public.restock_alerts a where a.ip_hash = v_ip and a.created_at > now() - interval '1 hour';
    if v_count >= 5 then
      return jsonb_build_object('ok', false, 'message', 'Hiciste varias solicitudes seguidas. Intenta más tarde o escríbenos por WhatsApp al 809-433-3348.');
    end if;
  end if;
  select count(*) into v_count from public.restock_alerts a where a.phone = v_phone and a.status = 'pendiente';
  if v_count >= 10 then
    return jsonb_build_object('ok', false, 'message', 'Ya tienes 10 avisos pendientes. Escríbenos por WhatsApp al 809-433-3348 y te ayudamos.');
  end if;
  select count(*) into v_count from public.restock_alerts a where a.created_at > now() - interval '1 hour';
  if v_count >= 300 then
    return jsonb_build_object('ok', false, 'message', 'En este momento no podemos anotar más avisos. Escríbenos por WhatsApp al 809-433-3348.');
  end if;
  insert into public.restock_alerts (product_id, customer_name, phone, ip_hash) values (p_product_id, v_name, v_phone, v_ip);
  -- Limpieza: los avisos ya enviados se borran a los 90 días y cualquier aviso a los 180 días.
  delete from public.restock_alerts a
   where (a.status = 'avisado' and a.notified_at < now() - interval '90 days') or a.created_at < now() - interval '180 days';
  return jsonb_build_object('ok', true, 'already', false, 'message', 'Listo: te escribiremos por WhatsApp cuando llegue.');
end;
$$;
revoke all on function public.request_restock_alert(bigint, text, text) from public;
grant execute on function public.request_restock_alert(bigint, text, text) to anon, authenticated;

-- 3) «Lo más vendido»: solo números de perfume, ordenados por unidades en pedidos confirmados de los últimos días.
create or replace function public.best_sellers(p_days integer default 120, p_limit integer default 12)
returns table (product_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with lineas as (
    select o.id as order_id, trim(l) as linea
      from public.orders o
      cross join lateral regexp_split_to_table(coalesce(o.items, ''), E'[\\r\\n;]+') as l
     where coalesce(o.status, 'nuevo') in ('confirmado', 'preparando', 'enviado', 'entregado')
       and o.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 120), 7), 365))
  ), partes as (
    select order_id,
           coalesce((regexp_match(linea, '^([0-9]{1,2})\s*[x×*]\s*'))[1]::integer, 1) as qty,
           lower(trim(regexp_replace(regexp_replace(regexp_replace(linea, '^[0-9]{1,2}\s*[x×*]\s*', ''), '^[-•·]\s*', ''), '\s*\([^)]*\)\s*$', ''))) as nombre
      from lineas
     where linea <> ''
  )
  select p.id
    from partes x
    join public.products p on lower(p.name) = x.nombre and p.active
   group by p.id
   order by sum(least(x.qty, 10)) desc, count(distinct x.order_id) desc, p.id
   limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;
revoke all on function public.best_sellers(integer, integer) from public;
grant execute on function public.best_sellers(integer, integer) to anon, authenticated;

-- 4) Abonos de cada pedido (cuentas por cobrar). Solo administradores.
create table if not exists public.order_payments (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  method text not null default 'efectivo' check (method in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  note text not null default '' check (length(note) <= 200),
  paid_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists order_payments_order on public.order_payments (order_id);
alter table public.order_payments enable row level security;
revoke all on public.order_payments from anon, authenticated;
grant select, insert, update, delete on public.order_payments to authenticated;
drop policy if exists "Admins gestionan abonos" on public.order_payments;
create policy "Admins gestionan abonos" on public.order_payments for all to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

-- 5) Costos privados y fórmula de precios. Solo administradores (nadie más puede leerlos).
create table if not exists public.product_costs (
  product_id bigint primary key references public.products (id) on delete cascade,
  costs numeric(12,2)[] not null check (cardinality(costs) between 1 and 6 and 0 < all (costs)),
  strategy text not null default 'normal' check (strategy in ('gancho', 'normal', 'exclusivo')),
  competitor_price numeric(12,2) check (competitor_price is null or competitor_price > 0),
  supplier text not null default 'La Grada' check (length(supplier) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.product_costs enable row level security;
revoke all on public.product_costs from anon, authenticated;
grant select, insert, update, delete on public.product_costs to authenticated;
drop policy if exists "Admins gestionan costos" on public.product_costs;
create policy "Admins gestionan costos" on public.product_costs for all to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

alter table public.store_settings add column if not exists pricing jsonb not null default '{}'::jsonb;
grant update (pricing) on public.store_settings to authenticated;

-- 6) y 7) Datos: perfumes nuevos e «Inspirado en…».
create temp table modo on commit drop as select false as deshacer;  -- ← DESHACER: cambia false por true
create temp table resumen (orden int, cambio text, hechos_ahora bigint, ya_estaban bigint, total bigint) on commit drop;

create temp table nuevos (
  id bigint primary key, name text not null, brand text not null, price text not null, size text not null, gender text not null,
  notes_top text[] not null, notes_heart text[] not null, notes_base text[] not null, description text not null,
  inspired_by text, sort_order int not null
) on commit drop;
insert into nuevos (id, name, brand, price, size, gender, notes_top, notes_heart, notes_base, description, inspired_by, sort_order) values
  (421, 'Afnan Supremacy Collector''s Edition Pour Homme', 'Afnan', 'RD$4,150', '100 ML', 'hombre', array['Piña', 'Bergamota', 'Flores blancas', 'Manzana']::text[], array['Flor de azahar', 'Abedul', 'Ámbar']::text[], array['Musgo de roble', 'Almizcle', 'Ámbar gris']::text[], '', 'Creed Absolu Aventus', 420),
  (422, 'Armaf Club de Nuit Elite', 'Armaf', 'RD$4,450', '105 ML', 'hombre', array['Pimienta de Sichuan', 'Bergamota', 'Té verde', 'Pimienta rosa', 'Manzana']::text[], array['Rosa de mayo', 'Grosella negra', 'Notas aromáticas', 'Geranio', 'Notas terrosas']::text[], array['Vetiver', 'Almizcle', 'Cedro', 'Ámbar', 'Cachemira']::text[], '', null, 421),
  (423, 'Armaf Dunescape Dubai', 'Armaf', 'RD$3,950', '100 ML', 'unisex', array['Naranja sanguina', 'Bergamota', 'Mandarina', 'Jengibre', 'Limón', 'Salvia', 'Enebro']::text[], array['Manzana', 'Notas ozónicas', 'Cachemira', 'Geranio', 'Rosa']::text[], array['Almizcle', 'Sándalo', 'Ámbar']::text[], '', 'Yves Saint Laurent Y EDP', 422),
  (424, 'Armaf Eter Arabian Sky', 'Armaf', 'RD$4,150', '100 ML', 'unisex', array['Naranja', 'Piña', 'Limón', 'Toronja', 'Bergamota', 'Pimienta']::text[], array['Caramelo', 'Lavanda', 'Geranio', 'Ylang-ylang']::text[], array['Ámbar', 'Cedro', 'Almizcle', 'Pachulí', 'Vetiver', 'Cuero']::text[], '', null, 423),
  (425, 'Bharara Mast Rome Pink pour Vanille', 'Bharara', 'RD$3,350', '100 ML', 'mujer', array['Notas frescas']::text[], array['Notas florales']::text[], array['Vainilla', 'Ámbar', 'Maderas']::text[], '', null, 424),
  (426, 'Dumont Nitro Elixir Men', 'Dumont', 'RD$4,750', '100 ML', 'hombre', array['Bergamota', 'Cardamomo', 'Manzana', 'Naranja']::text[], array['Flor de azahar', 'Praliné', 'Menta', 'Geranio']::text[], array['Ámbar gris', 'Haba tonka', 'Ámbar', 'Musgo']::text[], '', 'Yves Saint Laurent MYSLF L''Absolu', 425),
  (427, 'Dumont Nitro Gold', 'Dumont', 'RD$4,550', '100 ML', 'unisex', array['Manzana', 'Pimienta rosa', 'Piña', 'Toronja', 'Pimienta negra', 'Mandarina']::text[], array['Sal marina', 'Notas marinas', 'Cedro', 'Coñac', 'Vetiver']::text[], array['Madera de ámbar', 'Sándalo', 'Almizcle', 'Toffee', 'Vainilla']::text[], '', null, 426),
  (428, 'Stallion 53 Green Sublime', 'Emper', 'RD$3,250', '100 ML', 'unisex', array['Té Lapsang Souchong']::text[], array['Jazmín']::text[], array['Vainilla']::text[], '', null, 427),
  (429, 'Stallion 53 Imperial', 'Emper', 'RD$3,250', '100 ML', 'unisex', array['Canela', 'Cardamomo', 'Flor de azahar', 'Bergamota', 'Pasiflora']::text[], array['Vainilla Bourbon', 'Elemí', 'Orquídea', 'Jazmín']::text[], array['Praliné', 'Almizcle', 'Ambroxan', 'Madera de guayaco', 'Haba tonka', 'Almendra confitada', 'Madera de ámbar']::text[], '', null, 428),
  (430, 'Stallion 53 Ivory Dream', 'Emper', 'RD$3,250', '100 ML', 'unisex', array['Bergamota']::text[], array['Lavanda']::text[], array['Maderas', 'Notas ahumadas']::text[], '', null, 429),
  (431, 'Stallion 53 La Furia', 'Emper', 'RD$3,250', '100 ML', 'mujer', array['Pitahaya']::text[], array['Frangipani', 'Peonía roja']::text[], array['Pachulí', 'Vainilla']::text[], '', null, 430),
  (432, 'Stallion 53 Paradise', 'Emper', 'RD$3,250', '100 ML', 'mujer', array['Frutas tropicales', 'Cítricos']::text[], array['Peonía', 'Flores blancas']::text[], array['Vainilla', 'Ámbar', 'Almizcle']::text[], '', null, 431),
  (433, 'French Avenue Liquid Brun Limited Edition', 'French Avenue', 'RD$5,450', '100 ML', 'unisex', array['Cardamomo', 'Lavanda', 'Cítricos']::text[], array['Flor de azahar', 'Madera de guayaco', 'Rosa']::text[], array['Vainilla', 'Haba tonka', 'Ámbar', 'Musgo de roble']::text[], '', null, 432),
  (434, 'French Avenue Veneno Scarlet', 'French Avenue', 'RD$4,150', '100 ML', 'unisex', array['Fresa', 'Mora', 'Caramelo']::text[], array['Frambuesa', 'Cedro', 'Canela']::text[], array['Cuero', 'Pachulí', 'Abeto', 'Haba tonka', 'Vainilla']::text[], '', null, 433),
  (435, 'French Avenue Vulcan Feu', 'French Avenue', 'RD$4,350', '100 ML', 'unisex', array['Mango', 'Limón', 'Jengibre', 'Ruibarbo']::text[], array['Pimienta rosa', 'Jazmín', 'Violeta', 'Praliné']::text[], array['Haba tonka', 'Cedro', 'Ámbar gris', 'Musgo']::text[], '', null, 434),
  (436, 'Lattafa Al Noble Ameer', 'Lattafa', 'RD$2,750', '100 ML', 'unisex', array['Pimienta rosa', 'Manzana', 'Romero']::text[], array['Clavo de olor', 'Notas florales']::text[], array['Oud', 'Pachulí', 'Ládano', 'Vetiver', 'Ciprés']::text[], '', null, 435),
  (437, 'Lattafa Al Noble Safeer', 'Lattafa', 'RD$2,750', '100 ML', 'unisex', array['Jengibre', 'Pimienta negra', 'Bergamota', 'Toronja']::text[], array['Heliotropo', 'Jazmín', 'Caramelo']::text[], array['Almizcle', 'Cipriol', 'Cachemira', 'Ámbar gris', 'Vainilla', 'Madera de guayaco']::text[], '', null, 436),
  (438, 'Lattafa Al Noble Wazeer', 'Lattafa', 'RD$2,750', '100 ML', 'unisex', array['Coñac', 'Azafrán', 'Nuez moscada', 'Manzana']::text[], array['Cedro', 'Sándalo', 'Whisky', 'Roble']::text[], array['Mirra', 'Ambroxan', 'Vainilla', 'Almizcle']::text[], '', null, 437),
  (439, 'Lattafa Ana Abiyedh Passion', 'Lattafa', 'RD$3,050', '60 ML', 'mujer', array['Maracuyá', 'Bergamota']::text[], array['Rosyfolia', 'Cachemira', 'Mahonial']::text[], array['Vainilla', 'Almizcle', 'Haba tonka', 'Ambrofix']::text[], '', null, 438),
  (440, 'Lattafa Bade''e Al Oud Black Exposed', 'Lattafa', 'RD$4,350', '100 ML', 'unisex', array['Toffee', 'Incienso', 'Pimienta rosa']::text[], array['Cacao', 'Maderas', 'Iris']::text[], array['Vainilla', 'Ládano']::text[], '', null, 439),
  (441, 'Lattafa Jasoor', 'Lattafa', 'RD$3,050', '100 ML', 'unisex', array['Manzana', 'Cardamomo', 'Bergamota']::text[], array['Tabaco', 'Lavanda', 'Geranio']::text[], array['Haba tonka', 'Cuero', 'Vetiver', 'Pachulí']::text[], '', null, 440),
  (442, 'Lattafa Jouri', 'Lattafa', 'RD$3,850', '100 ML', 'mujer', array['Pitahaya', 'Cereza', 'Naranja']::text[], array['Peonía', 'Frambuesa', 'Frangipani', 'Nenúfar']::text[], array['Vainilla', 'Pachulí', 'Haba tonka']::text[], '', null, 441),
  (443, 'Lattafa Khamrah Waha', 'Lattafa', 'RD$4,150', '100 ML', 'unisex', array['Bergamota', 'Yuzu', 'Enebro', 'Jengibre']::text[], array['Pepino', 'Sal marina', 'Salvia', 'Iris']::text[], array['Vainilla', 'Haba tonka', 'Almizcle', 'Ambrofix', 'Akigalawood']::text[], '', null, 442),
  (444, 'Lattafa Petra Viola', 'Lattafa', 'RD$4,150', '100 ML', 'mujer', array['Frambuesa', 'Violeta', 'Pimienta rosa']::text[], array['Algodón de azúcar', 'Lirio de los valles', 'Jazmín']::text[], array['Almizcle', 'Sándalo', 'Cedro']::text[], '', null, 443),
  (445, 'Lattafa Pride Amethyst', 'Lattafa', 'RD$4,350', '100 ML', 'unisex', array['Rosa búlgara']::text[], array['Rosa turca', 'Jazmín']::text[], array['Oud', 'Ámbar', 'Vainilla']::text[], '', null, 444),
  (446, 'Lattafa Pride London The City of Contrast', 'Lattafa', 'RD$3,750', '100 ML', 'unisex', array['Mandarina', 'Limón', 'Pimienta rosa']::text[], array['Manzana', 'Neroli', 'Jengibre', 'Nardo']::text[], array['Vainilla', 'Almizcle', 'Sándalo']::text[], '', null, 445),
  (447, 'Lattafa Pride Love in Paris', 'Lattafa', 'RD$3,750', '100 ML', 'unisex', array['Caramelo', 'Manzana']::text[], array['Jarabe de arce', 'Benjuí', 'Pomarrosa']::text[], array['Ámbar', 'Haba tonka', 'Pachulí', 'Cachemira']::text[], '', null, 446),
  (448, 'Lattafa Pride New York The City of Dreams', 'Lattafa', 'RD$3,750', '100 ML', 'unisex', array['Cereza', 'Nuez moscada', 'Pimienta negra']::text[], array['Coñac', 'Mimosa', 'Rosa']::text[], array['Ládano', 'Cedro', 'Musgo de roble', 'Pachulí']::text[], '', null, 447),
  (449, 'Orientica Royal Amber', 'Orientica', 'RD$5,350', '80 ML', 'unisex', array['Bergamota', 'Notas verdes']::text[], array['Notas dulces', 'Melón', 'Piña', 'Ámbar']::text[], array['Almizcle', 'Maderas', 'Vainilla']::text[], '', null, 448),
  (450, 'Rasasi Hawas Sapphire', 'Rasasi', 'RD$3,950', '100 ML', 'unisex', array['Guayaba', 'Grosella negra', 'Bergamota']::text[], array['Flor de azahar', 'Sándalo']::text[], array['Almizcle', 'Haba tonka', 'Ámbar gris']::text[], '', null, 449),
  (451, 'Rasasi Hawas Kobra for Him', 'Rasasi', 'RD$4,150', '100 ML', 'hombre', array['Jengibre', 'Mandarina', 'Bergamota']::text[], array['Canela', 'Té verde', 'Neroli']::text[], array['Ámbar', 'Almizcle', 'Maderas']::text[], '', 'Louis Vuitton Imagination', 450),
  (452, 'Rasasi Hawas Nautilus', 'Rasasi', 'RD$4,350', '100 ML', 'hombre', array['Ámbar gris', 'Agua de mar']::text[], array['Ciprés', 'Cedro']::text[], array['Madera flotante', 'Arena']::text[], '', null, 451),
  (453, 'Rasasi Hawas Verde', 'Rasasi', 'RD$4,150', '100 ML', 'hombre', array['Lima', 'Manzana verde']::text[], array['Romero']::text[], array['Pachulí', 'Ámbar']::text[], '', null, 452),
  (454, 'Rayhaan Azul', 'Rayhaan', 'RD$3,550', '100 ML', 'hombre', array['Limón', 'Bergamota']::text[], array['Flor de toronja']::text[], array['Sándalo', 'Calone']::text[], '', null, 453),
  (455, 'Rayhaan Pacific Aloha', 'Rayhaan', 'RD$3,050', '100 ML', 'unisex', array['Naranja sanguina', 'Melón', 'Limón']::text[], array['Sandía', 'Coco']::text[], array['Notas marinas', 'Madera de ámbar', 'Cacao']::text[], '', null, 454),
  (456, 'Rayhaan Tropical Vibe', 'Rayhaan', 'RD$3,950', '100 ML', 'unisex', array['Mango', 'Piña', 'Bergamota', 'Ron']::text[], array['Coco', 'Flores blancas', 'Notas marinas']::text[], array['Almizcle', 'Ámbar', 'Sándalo', 'Vetiver']::text[], '', null, 455),
  (457, 'Riiffs Freeze', 'Riiffs', 'RD$3,550', '100 ML', 'unisex', array['Hierbabuena', 'Ralladura de limón', 'Bergamota de Calabria', 'Toronja', 'Acorde de nieve']::text[], array['Acorde helado', 'Té', 'Jengibre', 'Salvia']::text[], array['Ámbar', 'Peonía', 'Cedro']::text[], '', null, 456),
  (458, 'Riiffs Freeze in Flames Extrait', 'Riiffs', 'RD$4,150', '100 ML', 'unisex', array['Hierbabuena', 'Frambuesa', 'Bergamota de Calabria', 'Manzana roja', 'Maracuyá']::text[], array['Té', 'Lavanda', 'Salvia']::text[], array['Almizcle', 'Cedro']::text[], '', null, 457),
  (459, 'Bharara Mast Rome Ivory pour Femme', 'Bharara', 'RD$3,050', '100 ML', 'mujer', array['Bergamota', 'Naranja']::text[], array['Flor de azahar', 'Ylang-ylang', 'Geranio', 'Rosa', 'Jazmín']::text[], array['Sándalo', 'Pachulí', 'Almizcle', 'Vainilla', 'Ámbar']::text[], '', null, 458),
  (460, 'Bharara Mast Rome Lucky', 'Bharara', 'RD$3,550', '100 ML', 'unisex', '{}'::text[], '{}'::text[], '{}'::text[], '', null, 459),
  (461, 'Zakat Z6', 'Zakat', 'RD$3,050', '100 ML', 'unisex', '{}'::text[], '{}'::text[], '{}'::text[], '', null, 460),
  (462, 'Calvin Klein CK One Shock EDT Men', 'Calvin Klein', 'RD$3,250', '200 ML', 'hombre', array['Clementina', 'Pepino', 'Acorde de bebida energética']::text[], array['Pimienta negra', 'Albahaca', 'Cardamomo']::text[], array['Tabaco', 'Almizcle', 'Pachulí', 'Madera de ámbar']::text[], '', null, 461),
  (463, '212 Men Heroes Forever Young EDT', 'Carolina Herrera', 'RD$6,950', '90 ML', 'hombre', array['Pera', 'Acorde de cannabis', 'Jengibre']::text[], array['Geranio', 'Salvia']::text[], array['Almizcle', 'Cuero']::text[], '', null, 462),
  (464, '212 NYC EDT Men', 'Carolina Herrera', 'RD$5,950', '100 ML', 'hombre', array['Notas verdes', 'Toronja', 'Especias', 'Bergamota', 'Lavanda', 'Petitgrain']::text[], array['Jengibre', 'Violeta', 'Gardenia', 'Salvia', 'Pimiento verde']::text[], array['Almizcle', 'Sándalo', 'Incienso', 'Vetiver', 'Madera de guayaco', 'Ládano']::text[], '', null, 463),
  (465, 'Carolina Herrera Bad Boy Extreme Men', 'Carolina Herrera', 'RD$7,150', '100 ML', 'hombre', array['Ciruela', 'Salvia']::text[], array['Cacao', 'Incienso']::text[], array['Vetiver', 'Pachulí', 'Resinas', 'Haba tonka']::text[], '', null, 464),
  (466, 'Carolina Herrera Bad Boy Le Parfum Men', 'Carolina Herrera', 'RD$6,850', '100 ML', 'hombre', array['Toronja', 'Cáñamo']::text[], array['Pimienta negra', 'Geranio']::text[], array['Cuero', 'Vetiver']::text[], '', null, 465),
  (467, 'Carolina Herrera Good Girl Blush Elixir Women', 'Carolina Herrera', 'RD$10,250', '80 ML', 'mujer', array['Bergamota', 'Mandarina']::text[], array['Ylang-ylang', 'Rosa']::text[], array['Vainilla', 'Pachulí']::text[], '', null, 466),
  (468, 'Coach Green EDT Men', 'Coach', 'RD$8,450', '100 ML', 'hombre', array['Kiwi', 'Bergamota']::text[], array['Romero', 'Geranio']::text[], array['Musgo', 'Cedro']::text[], '', null, 467),
  (469, 'JPG Divine Elixir Women', 'Jean Paul Gaultier', 'RD$9,250', '100 ML', 'mujer', array['Sal marina', 'Notas marinas', 'Ralladura de limón']::text[], array['Nardo', 'Ylang-ylang', 'Jazmín sambac']::text[], array['Vainilla', 'Haba tonka', 'Merengue', 'Pachulí']::text[], '', null, 468),
  (470, 'JPG Le Male Pride Edition EDT Men', 'Jean Paul Gaultier', 'RD$8,050', '125 ML', 'hombre', array['Naranja sanguina', 'Yuzu']::text[], array['Neroli', 'Flor de azahar']::text[], array['Almizcle', 'Maderas blancas']::text[], '', null, 469),
  (471, 'Lolita Lempicka Homme EDT', 'Lolita Lempicka', 'RD$3,950', '100 ML', 'hombre', array['Anís', 'Regaliz', 'Ajenjo', 'Hiedra']::text[], array['Azúcar', 'Ron', 'Almendra', 'Violeta', 'Agua de rosas', 'Flor de azahar']::text[], array['Vainilla', 'Almizcle', 'Cedro', 'Ládano']::text[], '', null, 470),
  (472, '360 For Men EDT', 'Perry Ellis', 'RD$3,350', '100 ML', 'hombre', array['Mandarina', 'Piña', 'Enebro']::text[], array['Lavanda', 'Salvia', 'Cardamomo']::text[], array['Almizcle', 'Sándalo', 'Maderas']::text[], '', null, 471),
  (473, 'Valentino Uomo Born In Roma EDT', 'Valentino', 'RD$8,050', '100 ML', 'hombre', array['Notas minerales', 'Hoja de violeta', 'Sal marina']::text[], array['Salvia', 'Jengibre']::text[], array['Maderas', 'Vetiver']::text[], '', null, 472),
  (474, 'Versace Man Eau Fraiche EDT', 'Versace', 'RD$5,150', '100 ML', 'hombre', array['Limón', 'Bergamota', 'Palo de rosa']::text[], array['Cedro', 'Estragón', 'Salvia', 'Pimienta']::text[], array['Ámbar', 'Almizcle', 'Azafrán', 'Maderas']::text[], '', null, 473),
  (475, 'Giardini di Toscana Bianco Latte', 'Giardini di Toscana', 'RD$11,650', '100 ML', 'unisex', array['Caramelo']::text[], array['Cumarina', 'Miel']::text[], array['Vainilla', 'Almizcle blanco']::text[], '', null, 474),
  (476, 'Lorenzo Pazzaglia Summer Hammer', 'Lorenzo Pazzaglia', 'RD$10,950', '100 ML', 'unisex', array['Mango', 'Piña', 'Coco', 'Bergamota', 'Ron']::text[], array['Leche de coco', 'Flores blancas', 'Notas marinas']::text[], array['Almizcle', 'Sándalo', 'Ámbar', 'Vetiver']::text[], '', null, 475),
  (477, 'Lorenzo Pazzaglia Sun-Gria', 'Lorenzo Pazzaglia', 'RD$11,050', '100 ML', 'unisex', array['Naranja sanguina', 'Canela', 'Mandarina', 'Bergamota', 'Limón', 'Jengibre', 'Pimienta rosa', 'Clavo de olor']::text[], array['Uva', 'Vino tinto', 'Frambuesa', 'Grosella negra', 'Durazno', 'Manzana', 'Rosa turca', 'Cardamomo']::text[], array['Azúcar morena', 'Vainilla', 'Haba tonka', 'Almizcle', 'Ámbar', 'Pachulí', 'Sándalo', 'Benjuí', 'Cedro', 'Abedul']::text[], '', null, 476),
  (478, 'Mancera French Riviera', 'Mancera', 'RD$8,950', '120 ML', 'unisex', array['Limón', 'Naranja', 'Mandarina', 'Jengibre', 'Pimienta']::text[], array['Notas marinas', 'Flor de tiaré', 'Pino', 'Mimosa', 'Vetiver']::text[], array['Sal marina', 'Almizcle blanco', 'Ámbar']::text[], '', null, 477),
  (479, 'Parfums de Marly Delina Women', 'Parfums de Marly', 'RD$16,850', '75 ML', 'mujer', array['Lichi', 'Ruibarbo', 'Bergamota', 'Nuez moscada', 'Grosella negra']::text[], array['Rosa turca', 'Peonía', 'Almizcle', 'Petalia', 'Vainilla']::text[], array['Cachemira', 'Incienso', 'Cedro', 'Vetiver haitiano', 'Caramelo']::text[], '', null, 478),
  (480, 'Parfums de Marly Layton', 'Parfums de Marly', 'RD$15,050', '125 ML', 'unisex', array['Manzana', 'Lavanda', 'Bergamota', 'Mandarina']::text[], array['Geranio', 'Violeta', 'Jazmín']::text[], array['Vainilla', 'Cardamomo', 'Sándalo', 'Pimienta', 'Madera de guayaco', 'Pachulí', 'Ámbar', 'Cumarina']::text[], '', null, 479),
  (481, 'Xerjoff Torino21', 'Xerjoff', 'RD$14,250', '50 ML', 'unisex', array['Menta', 'Limón', 'Albahaca', 'Tomillo']::text[], array['Lavanda', 'Jazmín', 'Romero', 'Grosella negra']::text[], array['Almizcle', 'Verbena de limón']::text[], '', null, 480),
  (482, 'Set Armaf Club de Nuit Untold 4PCS', 'Sets', 'RD$5,150', '105 ML', 'unisex', array['Azafrán', 'Jazmín']::text[], array['Madera de ámbar', 'Ámbar gris']::text[], array['Resina de abeto', 'Cedro']::text[], 'Set Armaf Club de Nuit Untold 4PCS: Club de Nuit Untold de Armaf (perfume principal de 105 ML) y 3 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 481),
  (483, 'Set Armaf Odyssey Aqua 4PCS', 'Sets', 'RD$4,450', 'Set 4 piezas', 'hombre', array['Naranja', 'Toronja', 'Artemisia']::text[], array['Menta', 'Lavanda']::text[], array['Ambroxan', 'Ciprés', 'Pachulí']::text[], 'Set Armaf Odyssey Aqua 4PCS: Odyssey Aqua de Armaf: perfume, desodorante en spray, gel de ducha y champú. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 482),
  (484, 'Set Dolce & Gabbana Light Blue Women 2PCS', 'Sets', 'RD$6,250', '100 ML', 'mujer', array['Sicilian Lemon', 'Manzana', 'Cedro']::text[], array['Bamboo', 'Jazmín', 'White Rose']::text[], array['Cedro', 'Almizcle', 'Ámbar']::text[], 'Set Dolce & Gabbana Light Blue Women 2PCS: Light Blue de Dolce & Gabbana para mujer: 2 frascos (100 ML y uno de viaje). Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 483),
  (485, 'Set Stallion 53 4 In 1', 'Sets', 'RD$3,550', '100 ML', 'unisex', array['Cardamomo', 'Violeta']::text[], array['Ámbar', 'Iris']::text[], array['Sándalo', 'Cuero', 'Cedro de Virginia']::text[], 'Set Stallion 53 4 In 1: Stallion 53 de Emper: perfume de 100 ML, spray de viaje, gel de ducha y limpiador facial. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 484),
  (486, 'Set Game of Spades Collection II 3PCS', 'Sets', 'RD$6,150', '30 ML', 'unisex', array['Bergamota', 'Mandarina', 'Naranja']::text[], array['Pimienta rosa', 'Pimienta', 'Cardamomo']::text[], array['Vetiver']::text[], 'Set Game of Spades Collection II 3PCS: Game of Spades Double Bonus, All-In y Bonus (3 frascos de 30 ML). Las notas que se muestran son las de Double Bonus. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 485),
  (487, 'Set Game of Spades Opal 4PCS', 'Sets', 'RD$5,350', '100 ML', 'unisex', array['Pera', 'Frambuesa', 'Bergamota']::text[], array['Notas verdes', 'Spices', 'Peonía']::text[], array['Sándalo', 'Almizcle', 'Ámbar']::text[], 'Set Game of Spades Opal 4PCS: Game of Spades Opal: perfume de 100 ML y 3 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 486),
  (488, 'Set Game of Spades Parfum 9 Minis', 'Sets', 'RD$4,950', '9 x 10 ML', 'unisex', '{}'::text[], '{}'::text[], '{}'::text[], 'Set Game of Spades Parfum 9 Minis: 9 miniaturas de 10 ML de la colección Game of Spades Parfum. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 487),
  (489, 'Set Game of Spades Rouge 4PCS', 'Sets', 'RD$5,350', '100 ML', 'unisex', array['Jazmín', 'Bergamota', 'Lavanda']::text[], array['Madera de ámbar', 'Ámbar gris']::text[], array['Maderas', 'Almizcle']::text[], 'Set Game of Spades Rouge 4PCS: Game of Spades Rouge: perfume de 100 ML y 3 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 488),
  (490, 'Set Lattafa Asad Collection 4PCS', 'Sets', 'RD$4,150', '4 x 25 ML', 'hombre', array['Pimienta negra', 'Tabaco', 'Piña']::text[], array['Pachulí', 'Café', 'Iris']::text[], array['Vainilla', 'Ámbar', 'Maderas secas']::text[], 'Set Lattafa Asad Collection 4PCS: Colección Asad de Lattafa en 4 frascos de 25 ML: Asad, Asad Zanzibar, Asad Bourbon y otra versión de la línea. Las notas que se muestran son las de Asad. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 489),
  (491, 'Set Lattafa Haya 3PCS', 'Sets', 'RD$4,350', '100 ML', 'unisex', array['Fresa', 'Champagne', 'Tangerine']::text[], array['Gardenia', 'Jazmín', 'Vanilla Orchid']::text[], array['Ámbar', 'Sándalo', 'Chestnut']::text[], 'Set Lattafa Haya 3PCS: Haya de Lattafa: perfume de 100 ML y 2 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 490),
  (492, 'Set Lattafa Musamam White Intense 3PCS', 'Sets', 'RD$4,450', '100 ML', 'unisex', array['Spices', 'Bergamota', 'Naranja']::text[], array['Coco', 'Ylang-ylang', 'Ambroxan']::text[], array['Sándalo', 'Almizcle', 'Benjuí']::text[], 'Set Lattafa Musamam White Intense 3PCS: Musamam White Intense de Lattafa: perfume de 100 ML y 2 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 491),
  (493, 'Set Rasasi Hawas Fire 3PCS', 'Sets', 'RD$5,250', '100 ML', 'hombre', array['Salvia esclarea']::text[], array['Notas marinas', 'Jazmín egipcio']::text[], array['Ámbar', 'Notas minerales', 'Ámbar gris']::text[], 'Set Rasasi Hawas Fire 3PCS: Hawas Fire de Rasasi: perfume de 100 ML y 2 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 492),
  (494, 'Set Rasasi Hawas Ice Travel 2PCS', 'Sets', 'RD$4,450', '100 ML', 'unisex', array['Manzana', 'Italian Lemon', 'Sicilian Bergamot']::text[], array['Ciruela', 'Flor de azahar', 'Cardamon']::text[], array['Almizcle', 'Ámbar', 'Driftwood']::text[], 'Set Rasasi Hawas Ice Travel 2PCS: Hawas Ice de Rasasi: perfume de 100 ML y uno de viaje. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 493),
  (495, 'Set Versace Eros 3PCS', 'Sets', 'RD$5,850', '100 ML', 'hombre', array['Menta', 'Manzana verde', 'Limón']::text[], array['Haba tonka', 'Ambroxan', 'Geranio']::text[], array['Vainilla de Madagascar', 'Cedro de Virginia', 'Cedro del Atlas']::text[], 'Set Versace Eros 3PCS: Versace Eros EDT: perfume de 100 ML y 2 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 494),
  (496, 'Set Versace Eros Flame 3PCS', 'Sets', 'RD$5,950', '100 ML', 'hombre', array['Mandarina', 'Madagascar Pepper', 'Limón']::text[], array['Geranio', 'Rosa', 'Pepperwood™']::text[], array['Vainilla', 'Haba tonka', 'Sándalo']::text[], 'Set Versace Eros Flame 3PCS: Versace Eros Flame: perfume de 100 ML y 2 piezas complementarias. Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.', null, 495);

create temp table inspirados (id bigint primary key, referencia text not null) on commit drop;
insert into inspirados (id, referencia) values
  (11, 'Jean Paul Gaultier Ultra Male'),  -- 9 PM EDP Men Afnan
  (18, 'Tom Ford Ombré Leather'),  -- Afnan Rare Carbon
  (21, 'Giardini di Toscana Bianco Latte'),  -- Afnan Zimaya Tiramisu Caramel
  (25, 'Louis Vuitton Afternoon Swim'),  -- Jean Lowe Azure EDP Spray
  (28, 'Xerjoff Erba Pura'),  -- Al Haramain Gold Edition
  (47, 'Chanel Coco Mademoiselle'),  -- Armaf Club de Nuit Women
  (48, 'Chanel Bleu de Chanel'),  -- Armaf Club de Nuit Blue Iconic
  (50, 'Creed Aventus'),  -- Armaf Club de Nuit Intense Men
  (52, 'Creed Millésime Impérial'),  -- Armaf Club de Nuit Milestone
  (53, 'Creed Silver Mountain Water'),  -- Armaf Club de Nuit Sillage
  (54, 'Maison Francis Kurkdjian Baccarat Rouge 540'),  -- Armaf Club de Nuit Untold
  (64, 'Paco Rabanne Invictus'),  -- Armaf Odyssey Aqua
  (73, 'Jean Paul Gaultier Scandal pour Homme'),  -- Armaf Odyssey Mandarin Sky
  (87, 'Dior Sauvage Elixir'),  -- Lattafa Asad
  (94, 'Initio Oud for Greatness'),  -- Lattafa Bade'e Al Oud For Glory
  (144, 'Giardini di Toscana Bianco Latte'),  -- Lattafa Eclaire
  (154, 'Maison Francis Kurkdjian Baccarat Rouge 540'),  -- Barakkat Rouge 540 Red
  (155, 'Maison Francis Kurkdjian Baccarat Rouge 540 Extrait'),  -- Barakkat Rouge 540 Extrait EDP
  (156, 'Parfums de Marly Althaïr'),  -- French Avenue Liquid Brun
  (211, 'Kilian Angels'' Share'),  -- Lattafa Khamrah
  (220, 'Parfums de Marly Delina'),  -- Maison Alhambra Delilah
  (268, 'Jean Paul Gaultier Ultra Male'),  -- Lattafa Ramz Silver
  (277, 'Louis Vuitton L''Immensité'),  -- Maison Alhambra Jean Lowe Inmortal
  (280, 'Giorgio Armani My Way'),  -- Maison Alhambra La Voie
  (281, 'Dior Sauvage'),  -- Maison Alhambra Salvo
  (318, 'Paco Rabanne Invictus Aqua'),  -- Rasasi Hawas For Him
  (331, 'Jean Paul Gaultier Le Male Le Parfum'),  -- Maison Alhambra Glacier Le Noir
  (376, 'Le Labo Santal 33');  -- Emper Stallion 53

-- Si alguien ya creó en el panel un perfume con uno de estos números y otro nombre, se detiene sin cambiar nada.
do $$
declare
  choque text;
begin
  select string_agg('#' || p.id || ' ' || p.name, ', ') into choque
    from public.products p join nuevos n using (id)
   where lower(p.name) <> lower(n.name);
  if choque is not null then
    raise exception 'Los números de los perfumes nuevos ya están ocupados por otros perfumes (%). No se cambió nada: avísame para ajustar el archivo.', choque;
  end if;
end $$;

with hechos as (
  insert into public.products (id, name, brand, price, size, gender, availability, notes_top, notes_heart, notes_base,
                               description, inspired_by, sort_order, active)
  overriding system value
  select n.id, n.name, n.brand, n.price, n.size, n.gender, 'disponible', n.notes_top, n.notes_heart, n.notes_base,
         n.description, n.inspired_by, n.sort_order, true
    from nuevos n, modo m
   where not m.deshacer and not exists (select 1 from public.products p where p.id = n.id)
  returning id
)
insert into resumen
select 1, 'Perfumes nuevos agregados', (select count(*) from hechos),
       (select count(*) from public.products p join nuevos n using (id), modo m where not m.deshacer),
       (select count(*) from nuevos, modo m where not m.deshacer);

with hechos as (
  delete from public.products p
   using nuevos n, modo m
   where m.deshacer and p.id = n.id and lower(p.name) = lower(n.name)
  returning p.id
)
insert into resumen
select 2, 'Perfumes nuevos quitados (deshacer)', (select count(*) from hechos),
       (select count(*) from nuevos n, modo m where m.deshacer and not exists (select 1 from public.products p where p.id = n.id)),
       (select count(*) from nuevos, modo m where m.deshacer);

-- Que el panel siga numerando después del último perfume.
select setval(pg_get_serial_sequence('public.products', 'id'), greatest((select max(id) from public.products), 1));

with hechos as (
  update public.products p
     set inspired_by = case when m.deshacer then null else i.referencia end,
         updated_at = now()
    from inspirados i, modo m
   where p.id = i.id
     and case when m.deshacer then p.inspired_by = i.referencia else p.inspired_by is null end
  returning p.id
)
insert into resumen
select 3, '«Inspirado en…» de los perfumes de la tienda', (select count(*) from hechos),
       (select count(*) from public.products p join inspirados i using (id), modo m
         where case when m.deshacer then p.inspired_by is null else p.inspired_by = i.referencia end),
       (select count(*) from inspirados);

with hechos as (
  update public.products p
     set brand = case when m.deshacer then 'French' else 'French Avenue' end,
         updated_at = now()
    from modo m
   where p.id in (152, 153, 156) and p.name ilike 'French Avenue%'
     and p.brand = case when m.deshacer then 'French Avenue' else 'French' end
  returning p.id
)
insert into resumen
select 4, 'Marca «French Avenue» completa', (select count(*) from hechos),
       (select count(*) from public.products p, modo m
         where p.id in (152, 153, 156) and p.name ilike 'French Avenue%'
           and p.brand = case when m.deshacer then 'French' else 'French Avenue' end),
       (select count(*) from public.products p where p.id in (152, 153, 156) and p.name ilike 'French Avenue%');

select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total
  from resumen order by orden;

-- «sin_cambiar» mayor que 0 en «Inspirado en» = ese perfume ya tenía otra referencia escrita en el panel: no se tocó.
-- FIN
