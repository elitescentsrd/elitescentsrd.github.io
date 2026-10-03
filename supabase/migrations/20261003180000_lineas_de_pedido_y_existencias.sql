-- LÍNEAS DE PEDIDO Y CANTIDAD EN CASA — 3 de octubre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Líneas de pedido (order_items): cada pedido se separa solo en perfume, tamaño, cantidad y precio. Así «Lo más
--      vendido», la ganancia y la lista de compra cuentan exacto aunque después le cambies el nombre a un perfume.
--      También se separan los pedidos que ya tienes (los que se reconocen por el nombre del perfume). La tienda sigue
--      creando los pedidos igual que hoy: si una línea no se reconoce queda «sin perfume», y si algo fallara al
--      separarlas, el pedido se guarda igual.
--   2. Cantidad en casa (product_stock, privada, solo administradores): por perfume y tamaño, desde el panel. Es
--      opcional: un perfume sin cantidad funciona como hoy. Al CONFIRMAR un pedido se descuenta (los «nuevos» no
--      apartan nada); si se cancela, vuelve a «nuevo» o se borra, se devuelve. Pasar de confirmado a enviado o
--      entregado no descuenta otra vez.
--   3. Disponibilidad automática: si la cantidad llega a 0, el perfume pasa a «Agotado»; si vuelves a tener (porque
--      pones cantidad o se cancela un pedido), vuelve a «Disponible». Los «Solo por encargo» no se tocan, y si tú
--      cambias la disponibilidad a mano, se respeta.
--   4. La tienda muestra «¡Quedan 2!» cuando quedan 3 o menos (columna stock_left: nunca la cantidad exacta si hay más).
--   5. «Lo más vendido» cuenta con las líneas de pedido.
--
-- Requisitos: el script del 30 de septiembre («FUNCIONES NUEVAS Y PERFUMES NUEVOS»).
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»: las tablas nuevas activan su protección aquí mismo). La primera línea empieza con «-- LÍNEAS DE
-- PEDIDO» y la última dice «-- FIN». Es seguro repetirlo.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo: quita las líneas de
-- pedido, la cantidad en casa y «¡Quedan…!», y «Lo más vendido» vuelve a leer el texto de los pedidos. Los pedidos y los
-- perfumes no se tocan (la disponibilidad queda como esté en ese momento).

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'Falta la migración de administrador. No se cambió nada.';
  end if;
  if to_regprocedure('public.best_sellers(integer,integer)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'inspired_by') then
    raise exception 'Primero corre el script «FUNCIONES NUEVAS Y PERFUMES NUEVOS» (30 de septiembre). No se cambió nada.';
  end if;
end $$;

create temp table modo on commit drop as select false as deshacer;  -- ← DESHACER: cambia false por true

-- 0b) Turno: aparta perfumes y pedidos un instante, sin esperar con algo apartado (así no choca con un cliente que compra).
do $$
begin
  for intento in 1..80 loop
    begin
      lock table public.products in access exclusive mode nowait;
      if (select deshacer from modo) then
        lock table public.orders in access exclusive mode nowait;
      else
        lock table public.orders in share row exclusive mode nowait;
      end if;
      return;
    exception when lock_not_available then
      perform pg_sleep(0.25);
    end;
  end loop;
  raise exception 'La tienda está muy ocupada en este momento. Espera un minuto y vuelve a darle Run. No se cambió nada.';
end $$;

-- 1) Tablas.
create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  position smallint not null check (position between 1 and 200),
  product_id bigint references public.products (id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  size text check (size is null or length(size) <= 60),
  size_index smallint check (size_index is null or size_index between 0 and 5),
  qty integer not null check (qty between 1 and 99),
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  stock_taken integer not null default 0 check (stock_taken >= 0),
  unique (order_id, position)
);
create index if not exists order_items_product on public.order_items (product_id);
alter table public.order_items enable row level security;
revoke all on public.order_items from anon, authenticated;
grant select on public.order_items to authenticated;
drop policy if exists "Admins leen lineas de pedido" on public.order_items;
create policy "Admins leen lineas de pedido" on public.order_items for select to authenticated
  using ((select private.is_store_admin()));

create table if not exists public.product_stock (
  product_id bigint not null references public.products (id) on delete cascade,
  size_index smallint not null default 0 check (size_index between 0 and 5),
  qty integer not null check (qty between 0 and 9999),
  updated_at timestamptz not null default now(),
  primary key (product_id, size_index)
);
alter table public.product_stock enable row level security;
revoke all on public.product_stock from anon, authenticated;
grant select, insert, update, delete on public.product_stock to authenticated;
drop policy if exists "Admins gestionan cantidades" on public.product_stock;
create policy "Admins gestionan cantidades" on public.product_stock for all to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

-- Perfumes que pasaron a «Agotado» por llegar a 0 (para devolverlos a «Disponible» solos, y solo a esos).
create table if not exists private.stock_auto (product_id bigint primary key references public.products (id) on delete cascade);
revoke all on private.stock_auto from public, anon, authenticated;

alter table public.products add column if not exists stock_left smallint
  constraint products_stock_left_range check (stock_left is null or stock_left between 0 and 3);

-- 2) Leer el texto de un pedido: «2x Lattafa Asad (100 ML)», «- Perfume · 100 ml» o una línea por perfume.
create or replace function private.norm_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç', 'AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc')), '\s+', ' ', 'g'));
$$;
-- Para reconocer al instante el perfume de cada línea.
create index if not exists products_name_norm on public.products (private.norm_text(name));

create or replace function private.order_lines(p_items text)
returns table (pos integer, qty integer, name text, size text, alt_name text, alt_size text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line text;
  v_match text[];
  v_qty integer;
  v_size text;
  v_alt text[];
  v_pos integer := 0;
begin
  foreach v_line in array regexp_split_to_array(coalesce(p_items, ''), E'\\r?\\n|;') loop
    v_line := btrim(v_line);
    continue when v_line = '';
    v_qty := 1;
    v_match := regexp_match(v_line, '^([0-9]{1,2})\s*[xX×*]\s*(.+)$');
    if v_match is not null then
      v_qty := greatest(v_match[1]::integer, 1);
      v_line := v_match[2];
    else
      v_line := regexp_replace(v_line, '^[-•·]\s*', '');
    end if;
    v_size := (regexp_match(v_line, '\(([^)]*)\)\s*$'))[1];
    if v_size is not null then
      v_line := regexp_replace(v_line, '\s*\([^)]*\)\s*$', '');
    else
      v_size := (regexp_match(v_line, '\s*[·|]\s*([0-9]+\s*ml.*)$', 'i'))[1];
      if v_size is not null then v_line := regexp_replace(v_line, '\s*[·|]\s*[0-9]+\s*ml.*$', '', 'i'); end if;
    end if;
    v_line := btrim(v_line);
    continue when v_line = '';
    v_pos := v_pos + 1;
    exit when v_pos > 200;
    -- Por si el nombre trae el tamaño al final («Armaf Odyssey Homme 100ml», «… - 100 ML»): se prueba sin él si el
    -- nombre completo no es de ningún perfume.
    v_alt := case when v_size is null then regexp_match(v_line, '^(.+?)\s*[-—–·|,]?\s*([0-9]+(?:[.,][0-9]+)?\s*ml\.?)$', 'i') end;
    pos := v_pos;
    qty := least(v_qty, 99);
    name := left(v_line, 200);
    size := nullif(left(btrim(v_size), 60), '');
    alt_name := left(btrim(v_alt[1]), 200);
    alt_size := left(btrim(v_alt[2]), 60);
    return next;
  end loop;
end;
$$;

-- Tamaños de un perfume («60 / 100 ML»): cuál es el de la línea (por el número) y su precio («RD$3,450 / RD$4,150»).
create or replace function private.size_number(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace((regexp_match(coalesce(p, ''), '([0-9]+(?:[.,][0-9]+)?)'))[1], ',', '.');
$$;

create or replace function private.size_index(p_sizes text, p_size text)
returns smallint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_list text[] := regexp_split_to_array(btrim(coalesce(p_sizes, '')), '\s*/\s*');
  v_want text := private.size_number(p_size);
begin
  if coalesce(array_length(v_list, 1), 0) <= 1 then
    return 0; -- un solo tamaño
  end if;
  if v_want is null then
    return null;
  end if;
  for i in 1 .. least(array_length(v_list, 1), 6) loop
    if private.size_number(v_list[i]) = v_want then
      return i - 1;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function private.size_matches(p_sizes text, p_size text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.size_number(p_size) is not null
     and private.size_number(p_size) = any (select private.size_number(t) from unnest(regexp_split_to_array(coalesce(p_sizes, ''), '\s*/\s*')) t);
$$;

create or replace function private.price_at(p_price text, p_index smallint)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select replace(replace(m.v[1], ',', ''), '.', '')::numeric
    from regexp_matches(coalesce(p_price, ''), '([0-9][0-9,.]*)', 'g') with ordinality as m(v, n)
   where p_index is not null and m.n = p_index + 1;
$$;

-- 3) Disponibilidad y «¡Quedan…!» según la cantidad en casa (solo cambia lo que hay que cambiar).
create or replace function private.refresh_stock_state(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_left smallint;
  v_avail text;
  v_ids bigint[] := '{}';
  v_lefts smallint[] := '{}';
  v_avails text[] := '{}';
  v_auto_on bigint[] := '{}';
  v_auto_off bigint[] := '{}';
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  for r in
    select p.id, p.availability, p.stock_left, count(s.product_id) as tracked, coalesce(sum(s.qty), 0) as total,
           exists (select 1 from private.stock_auto a where a.product_id = p.id) as auto
      from public.products p
      left join public.product_stock s on s.product_id = p.id
     where p.id = any (p_ids)
     group by p.id
     order by p.id
  loop
    v_left := case when r.tracked > 0 and r.total <= 3 then r.total::smallint end;
    v_avail := r.availability;
    if r.tracked > 0 and r.total = 0 and r.availability = 'disponible' then
      v_avail := 'agotado';
      v_auto_on := v_auto_on || r.id;
    elsif r.tracked > 0 and r.total > 0 and r.availability = 'agotado' and r.auto then
      v_avail := 'disponible';
      v_auto_off := v_auto_off || r.id;
    elsif r.tracked = 0 and r.auto then
      v_auto_off := v_auto_off || r.id; -- ya no se lleva la cantidad: se olvida la marca
    end if;
    if v_left is distinct from r.stock_left or v_avail is distinct from r.availability then
      v_ids := v_ids || r.id;
      v_lefts := v_lefts || v_left;
      v_avails := v_avails || v_avail;
    end if;
  end loop;
  perform set_config('elite.stock_sync', '1', true);
  if cardinality(v_ids) > 0 then
    -- Una sola orden para todos (y solo si algo cambió): la web se vuelve a publicar una vez, no por cada perfume.
    update public.products p set stock_left = c.l, availability = c.a
      from unnest(v_ids, v_lefts, v_avails) as c(id, l, a)
     where p.id = c.id;
  end if;
  insert into private.stock_auto (product_id) select unnest(v_auto_on) on conflict (product_id) do nothing;
  delete from private.stock_auto where product_id = any (v_auto_off);
  perform set_config('elite.stock_sync', '', true);
end;
$$;

-- 4) Líneas y cantidades de un pedido. Devuelve lo descontado antes de volver a descontar y aparta las cantidades
--    siempre en el mismo orden (así dos cambios a la vez no se traban).
create or replace function private.sync_order(p_order_id bigint, p_reparse boolean, p_return boolean, p_take boolean, p_with_price boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items text;
  v_found boolean;
  v_back_ids bigint[];
  v_back_sizes smallint[];
  v_back_qty integer[];
  v_touched bigint[] := '{}';
  r record;
  v_have integer;
  v_take integer;
begin
  select o.items into v_items from public.orders o where o.id = p_order_id;
  v_found := found;
  perform set_config('elite.stock_sync', '1', true);

  -- Lo que este pedido había descontado (se devuelve si cambia de estado o de líneas, o si se borra).
  select coalesce(array_agg(i.product_id order by i.product_id, i.size_index), '{}'),
         coalesce(array_agg(i.size_index order by i.product_id, i.size_index), '{}'),
         coalesce(array_agg(i.stock_taken order by i.product_id, i.size_index), '{}')
    into v_back_ids, v_back_sizes, v_back_qty
    from public.order_items i
   where i.order_id = p_order_id and i.stock_taken > 0 and i.product_id is not null and i.size_index is not null
     and (p_return or p_reparse);
  if p_return or p_reparse then
    update public.order_items set stock_taken = 0 where order_id = p_order_id and stock_taken > 0;
  end if;

  if p_reparse then
    delete from public.order_items where order_id = p_order_id;
    if v_found then
      insert into public.order_items (order_id, position, product_id, name, size, size_index, qty, unit_price)
      select p_order_id, l.pos, m.id, l.name, coalesce(m.line_size, l.size),
             case when m.id is not null then private.size_index(m.size, m.line_size) end,
             l.qty,
             case when m.id is not null and p_with_price then private.price_at(m.price, private.size_index(m.size, m.line_size)) end
        from private.order_lines(v_items) l
        left join lateral (
          select c.id, c.size, c.price, c.line_size
            from (select p.id, p.size, p.price, p.active, l.size as line_size, 0 as rank
                    from public.products p where private.norm_text(p.name) = private.norm_text(l.name)
                  union all
                  select p.id, p.size, p.price, p.active, l.alt_size, 1
                    from public.products p where l.alt_name is not null and private.norm_text(p.name) = private.norm_text(l.alt_name)) c
           order by c.rank, private.size_matches(c.size, c.line_size) desc, c.active desc, c.id
           limit 1
        ) m on true;
    end if;
  end if;

  -- Aparta en orden las cantidades que se van a tocar (las que se devuelven y las que se descuentan).
  perform 1
     from public.product_stock s
    where (s.product_id, s.size_index) in (
            select * from unnest(v_back_ids, v_back_sizes)
            union
            select i.product_id, i.size_index from public.order_items i
             where p_take and v_found and i.order_id = p_order_id and i.product_id is not null and i.size_index is not null)
    order by s.product_id, s.size_index
    for update;

  if cardinality(v_back_ids) > 0 then
    update public.product_stock s set qty = least(s.qty + b.qty, 9999), updated_at = now()
      from (select x.pid, x.sz, sum(x.q) as qty from unnest(v_back_ids, v_back_sizes, v_back_qty) as x(pid, sz, q) group by x.pid, x.sz) b
     where s.product_id = b.pid and s.size_index = b.sz;
    v_touched := v_touched || v_back_ids;
  end if;

  if p_take and v_found then
    for r in
      select i.id, i.product_id, i.size_index, i.qty
        from public.order_items i
       where i.order_id = p_order_id and i.product_id is not null and i.size_index is not null
       order by i.product_id, i.size_index, i.id
    loop
      select s.qty into v_have from public.product_stock s where s.product_id = r.product_id and s.size_index = r.size_index;
      if found then
        v_take := least(v_have, r.qty);
        if v_take > 0 then
          update public.product_stock s set qty = s.qty - v_take, updated_at = now()
           where s.product_id = r.product_id and s.size_index = r.size_index;
          update public.order_items set stock_taken = v_take where id = r.id;
        end if;
        v_touched := v_touched || r.product_id;
      end if;
    end loop;
  end if;

  perform private.refresh_stock_state(array(select distinct x from unnest(v_touched) x order by x));
  perform set_config('elite.stock_sync', '', true);
end;
$$;

-- 5) Disparadores. Un error aquí NUNCA impide guardar, cambiar ni borrar un pedido (queda un aviso en el registro).
create or replace function private.orders_lines_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_sold boolean := false;
  v_is_sold boolean := coalesce(new.status, 'nuevo') in ('confirmado', 'preparando', 'enviado', 'entregado');
  v_items_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_was_sold := coalesce(old.status, 'nuevo') in ('confirmado', 'preparando', 'enviado', 'entregado');
    v_items_changed := new.items is distinct from old.items;
    if not v_items_changed and v_was_sold = v_is_sold then
      return null; -- de confirmado a enviado o entregado (o un cambio de fecha): nada que hacer
    end if;
  end if;
  begin
    perform private.sync_order(new.id, v_items_changed, v_was_sold and (not v_is_sold or v_items_changed),
                               v_is_sold and (not v_was_sold or v_items_changed), true);
  exception when others then
    raise warning 'Pedido %: no se pudieron leer las líneas (%). El pedido se guardó igual.', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function private.orders_return_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.sync_order(old.id, false, true, false, false);
  exception when others then
    raise warning 'Pedido %: no se pudo devolver la cantidad (%). El pedido se borró igual.', old.id, sqlerrm;
  end;
  return old;
end;
$$;

create or replace function private.product_stock_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('elite.stock_sync', true), '') <> '1' then
    perform private.refresh_stock_state(array[coalesce(new.product_id, old.product_id)]);
  end if;
  return null;
end;
$$;

-- Si cambias a mano la disponibilidad de un perfume, ya no se devuelve solo a «Disponible».
create or replace function private.products_forget_stock_auto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('elite.stock_sync', true), '') <> '1' then
    delete from private.stock_auto where product_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function private.norm_text(text) from public, anon, authenticated;
revoke all on function private.order_lines(text) from public, anon, authenticated;
revoke all on function private.size_number(text) from public, anon, authenticated;
revoke all on function private.size_index(text, text) from public, anon, authenticated;
revoke all on function private.size_matches(text, text) from public, anon, authenticated;
revoke all on function private.price_at(text, smallint) from public, anon, authenticated;
revoke all on function private.refresh_stock_state(bigint[]) from public, anon, authenticated;
revoke all on function private.sync_order(bigint, boolean, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function private.orders_lines_after() from public, anon, authenticated;
revoke all on function private.orders_return_stock() from public, anon, authenticated;
revoke all on function private.product_stock_changed() from public, anon, authenticated;
revoke all on function private.products_forget_stock_auto() from public, anon, authenticated;

create or replace trigger orders_lines_after
  after insert or update of items, status on public.orders
  for each row execute function private.orders_lines_after();
create or replace trigger orders_return_stock
  before delete on public.orders
  for each row execute function private.orders_return_stock();
create or replace trigger product_stock_changed
  after insert or update or delete on public.product_stock
  for each row execute function private.product_stock_changed();
create or replace trigger products_forget_stock_auto
  after update of availability on public.products
  for each row when (old.availability is distinct from new.availability)
  execute function private.products_forget_stock_auto();

-- 6) Separar los pedidos que ya tienes (solo líneas: no descuenta nada de la cantidad en casa).
do $$
declare
  v_id bigint;
begin
  if not (select deshacer from modo) then
    for v_id in select o.id from public.orders o where not exists (select 1 from public.order_items i where i.order_id = o.id) order by o.id loop
      perform private.sync_order(v_id, true, false, false, false);
    end loop;
  end if;
end $$;

-- 7) «Lo más vendido» con las líneas de pedido (igual que antes: pedidos confirmados de los últimos días, solo números).
create or replace function public.best_sellers(p_days integer default 120, p_limit integer default 12)
returns table (product_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.product_id
    from public.order_items i
    join public.orders o on o.id = i.order_id
    join public.products p on p.id = i.product_id and p.active
   where coalesce(o.status, 'nuevo') in ('confirmado', 'preparando', 'enviado', 'entregado')
     and o.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 120), 7), 365))
   group by i.product_id
   order by sum(least(i.qty, 10)) desc, count(distinct i.order_id) desc, i.product_id
   limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;
revoke all on function public.best_sellers(integer, integer) from public;
grant execute on function public.best_sellers(integer, integer) to anon, authenticated;

-- DESHACER: quita todo lo de este archivo y «Lo más vendido» vuelve a leer el texto de los pedidos.
do $$
begin
  if (select deshacer from modo) then
    drop trigger if exists orders_lines_after on public.orders;
    drop trigger if exists orders_return_stock on public.orders;
    drop trigger if exists products_forget_stock_auto on public.products;
    drop table if exists public.order_items;
    drop table if exists public.product_stock;
    drop table if exists private.stock_auto;
    drop index if exists public.products_name_norm;
    alter table public.products drop column if exists stock_left;
    drop function if exists private.orders_lines_after();
    drop function if exists private.orders_return_stock();
    drop function if exists private.product_stock_changed();
    drop function if exists private.products_forget_stock_auto();
    drop function if exists private.sync_order(bigint, boolean, boolean, boolean, boolean);
    drop function if exists private.refresh_stock_state(bigint[]);
    drop function if exists private.price_at(text, smallint);
    drop function if exists private.size_matches(text, text);
    drop function if exists private.size_index(text, text);
    drop function if exists private.size_number(text);
    drop function if exists private.order_lines(text);
    drop function if exists private.norm_text(text);
    create or replace function public.best_sellers(p_days integer default 120, p_limit integer default 12)
    returns table (product_id bigint)
    language sql
    stable
    security definer
    set search_path = ''
    as $f$
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
    $f$;
    revoke all on function public.best_sellers(integer, integer) from public;
    grant execute on function public.best_sellers(integer, integer) to anon, authenticated;
  end if;
end $$;

-- Resumen (se arma aparte para no nombrar tablas que, al deshacer, ya no existen).
create temp table resumen (orden integer, cambio text, estado text) on commit drop;
do $$
declare
  v_lineas text := 'quitadas';
begin
  if to_regclass('public.order_items') is not null then
    execute $q$select count(distinct order_id) || ' pedidos, ' || count(*) || ' líneas'
                 || case when count(*) filter (where product_id is null) > 0
                         then ' (' || count(*) filter (where product_id is null) || ' sin perfume reconocido)' else '' end
                 from public.order_items$q$ into v_lineas;
  end if;
  insert into resumen values
    (1, 'Líneas de pedido', v_lineas),
    (2, 'Cantidad en casa, «¡Quedan…!» y agotado automático',
        case when to_regclass('public.product_stock') is null then 'quitada'
             else 'lista: pon la cantidad en el panel (perfume por perfume); sin cantidad, todo sigue como hoy' end),
    (3, '«Lo más vendido»',
        case when to_regclass('public.order_items') is null then 'lee el texto de los pedidos (como antes)' else 'cuenta con las líneas de pedido' end);
end $$;
select cambio, estado from resumen order by orden;
-- FIN
