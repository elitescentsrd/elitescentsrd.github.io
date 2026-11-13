-- ELIVI SECTIO 99 — 13 de noviembre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Agrega UN perfume nuevo a la tienda: «Elivi Sectio 99 Extrait de Parfum» (número 539), 50 ML, unisex,
--      precio RD$11,200 (margen alto, redondeado). Como pasa de RD$7,000, queda «Solo por encargo» (regla de siempre).
--      Sin notas todavía: sale sin notas hasta que las escribas en el panel (igual que los otros Elivi).
--   2. La foto ya está en el repositorio (img/productos/0539-elivi-sectio-99.jpg): el sitio la toma sola por el número.
--
-- Si alguien ya creó en el panel un perfume con el número 539 y otro nombre, se detiene sin cambiar nada.
-- Es seguro repetirlo: si ya está, no se vuelve a agregar. Al final verás una tabla con lo que se hizo.
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- ELIVI SECTIO 99» y la última dice «-- FIN».
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo. Quita el perfume
-- (solo si sigue con este mismo nombre).

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regclass('public.products') is null then
    raise exception 'No existe la tabla public.products. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'brand') then
    raise exception 'La tabla products no tiene las columnas esperadas (brand). No se cambió nada.';
  end if;
end $$;

-- 0b) Turno: aparta la tabla unos segundos sin quedarse esperando. Si alguien está comprando en ese momento, suelta
--     todo, espera un instante y vuelve a intentar (así no choca: «deadlock detected»).
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

-- 1) El perfume nuevo.
create temp table nuevos (
  id bigint primary key, name text not null, brand text not null, price text not null, size text not null, gender text not null,
  availability text not null, notes_top text[] not null, notes_heart text[] not null, notes_base text[] not null
) on commit drop;
insert into nuevos (id, name, brand, price, size, gender, availability, notes_top, notes_heart, notes_base) values
  (539, 'Elivi Sectio 99 Extrait de Parfum', 'Elivi', 'RD$11,200', '50 ML', 'unisex', 'encargo', array[]::text[], array[]::text[], array[]::text[]);

-- Si el número 539 ya está ocupado por otro perfume, se detiene sin cambiar nada.
do $$
declare
  choque text;
begin
  select string_agg('#' || p.id || ' ' || p.name, ', ') into choque
    from public.products p join nuevos n using (id)
   where lower(p.name) <> lower(n.name);
  if choque is not null then
    raise exception 'El número del perfume nuevo ya está ocupado por otro perfume (%). No se cambió nada: avísame para ajustar el archivo.', choque;
  end if;
end $$;

with hechos as (
  insert into public.products (id, name, brand, price, size, gender, availability, notes_top, notes_heart, notes_base, sort_order, active)
  overriding system value
  select n.id, n.name, n.brand, n.price, n.size, n.gender, n.availability, n.notes_top, n.notes_heart, n.notes_base,
         (select coalesce(max(sort_order), 0) + 1 from public.products), true
    from nuevos n, modo m
   where not m.deshacer and not exists (select 1 from public.products p where p.id = n.id)
  returning id
)
insert into resumen
select 1, 'Perfume nuevo agregado', (select count(*) from hechos),
       (select count(*) from public.products p join nuevos n using (id), modo m where not m.deshacer),
       (select count(*) from nuevos, modo m where not m.deshacer);

with hechos as (
  delete from public.products p
   using nuevos n, modo m
   where m.deshacer and p.id = n.id and lower(p.name) = lower(n.name)
  returning p.id
)
insert into resumen
select 1, 'Perfume nuevo quitado (deshacer)', (select count(*) from hechos),
       (select count(*) from nuevos n, modo m where m.deshacer and not exists (select 1 from public.products p where p.id = n.id)),
       (select count(*) from nuevos, modo m where m.deshacer);

-- Que el panel siga numerando después del último perfume.
select setval(pg_get_serial_sequence('public.products', 'id'), greatest((select max(id) from public.products), 1));

-- 2) Resultado.
select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total
  from resumen
 order by orden, cambio;

-- La primera vez verás «hechos_ahora = 1». Si lo repites: aparece en «ya_estaban».
-- FIN
