-- PRECIOS DE LA GRADA DE NOVIEMBRE — 10 de noviembre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Cambia el precio de 94 perfumes porque cambió lo que cuestan en La Grada (segundo catálogo de noviembre), con
--      la misma fórmula de ganancia de siempre y la estrategia de cada perfume: 89 suben y 5 bajan.
--      Los que llegan a RD$7,000 o más quedan «Solo por encargo» (regla de siempre).
--   2. Guarda una copia de cómo estaban esos precios (private.precios_antes_20261110), para poder deshacer.
--
-- Lo que cambiaste a mano en el panel se respeta: un precio solo se cambia si sigue igual al de hoy (10 de noviembre).
-- Al final verás una tabla con lo que se hizo y, si alguno no se tocó, cuál y por qué.
-- Este archivo NO trae costos: tus costos nuevos van en tu archivo privado (no está en GitHub).
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- PRECIOS DE LA GRADA DE NOVIEMBRE» y la última dice «-- FIN».
--
-- Es seguro repetirlo: lo que ya está hecho no se repite.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo. Devuelve los precios
-- y la disponibilidad de antes (solo donde el precio sigue siendo el que puso este archivo).

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'No existe private.is_store_admin(): aplica antes la migración de administrador. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'original_price') then
    raise exception 'Falta la migración de ofertas (20260921121000_ofertas.sql). No se cambió nada.';
  end if;
  if not exists (select 1 from public.products where id = 538) then
    raise exception 'Primero aplica el script del catálogo de octubre (20261016120000_catalogo_la_grada_octubre.sql). No se cambió nada.';
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

-- 1) Precios que cambian. «antes» es el precio de hoy en tu tienda; si dice otra cosa (lo cambiaste en el panel),
--    ese perfume no se toca.
create temp table cambios (
  id bigint primary key, nombre text not null, antes text not null, ahora text not null
) on commit drop;
insert into cambios (id, nombre, antes, ahora) values
  (1, '212 Sexy EDT Men', 'RD$5,150', 'RD$5,250'),
  (10, '9 AM Dive Blue EDP Men Afnan', 'RD$2,750', 'RD$2,850'),
  (11, '9 PM EDP Men Afnan', 'RD$2,750', 'RD$2,950'),
  (12, '9 PM Elixir Men Afnan', 'RD$3,600', 'RD$4,150'),
  (13, '9 PM Rebel Men Afnan', 'RD$3,350', 'RD$3,550'),
  (16, 'Acqua di Giò Profondo EDP Men', 'RD$6,950', 'RD$8,050'),
  (33, 'Ana Abiyedh Coral EDP Spray', 'RD$2,650', 'RD$2,750'),
  (34, 'Ariana Grande Thank U Next', 'RD$4,350', 'RD$5,150'),
  (43, 'Armaf Club de Nuit Précieux I', 'RD$4,550', 'RD$4,750'),
  (46, 'Armaf Club de Nuit Précieux IV', 'RD$4,550', 'RD$4,750'),
  (50, 'Armaf Club de Nuit Intense Men', 'RD$2,750', 'RD$2,950'),
  (57, 'Armaf Island Bliss Delights', 'RD$3,900', 'RD$4,450'),
  (58, 'Armaf Yum Yum', 'RD$3,900', 'RD$4,450'),
  (59, 'Armaf Island Bon Bon Delights', 'RD$3,900', 'RD$4,450'),
  (60, 'Armaf Island Breeze Delights', 'RD$3,900', 'RD$4,450'),
  (62, 'Armaf Odyssey Mandarin Elixir', 'RD$3,050', 'RD$3,350'),
  (63, 'Armaf Odyssey Aoud Edition', 'RD$2,850', 'RD$3,050'),
  (65, 'Armaf Odyssey Artisto', 'RD$3,300', 'RD$3,450'),
  (66, 'Armaf Odyssey Bahamas', 'RD$3,400', 'RD$3,450'),
  (67, 'Armaf Odyssey Black Forest', 'RD$3,400', 'RD$3,950'),
  (71, 'Armaf Odyssey Homme White', 'RD$2,850 / RD$3,650', 'RD$3,050 / RD$3,650'),
  (73, 'Armaf Odyssey Mandarin Sky', 'RD$2,750', 'RD$2,950'),
  (78, 'Armaf Odyssey Toffee Coffee', 'RD$3,400', 'RD$3,950'),
  (89, 'Lattafa Atlas', 'RD$3,250', 'RD$3,350'),
  (90, 'Azzaro Most Wanted Toilette', 'RD$5,150', 'RD$5,250'),
  (97, 'Lattafa Bade''e Al Oud Noble Blush', 'RD$2,850', 'RD$3,050'),
  (103, 'Bharara Rome Paradox', 'RD$3,000', 'RD$3,350'),
  (105, 'Bharara Rome Imagine', 'RD$3,000', 'RD$3,350'),
  (118, 'Carolina Herrera La Bomba', 'RD$10,350', 'RD$10,250'),
  (122, 'Diesel Plus Plus Man', 'RD$2,150', 'RD$1,650'),
  (123, 'Diesel Plus Plus Women', 'RD$2,150', 'RD$1,650'),
  (153, 'French Avenue Atlantis Extrait', 'RD$3,950', 'RD$4,350'),
  (183, 'Hayaati Black', 'RD$2,450', 'RD$2,750'),
  (184, 'Hayaati Florence', 'RD$2,450', 'RD$2,750'),
  (185, 'Hayaati Al Maleky', 'RD$2,450', 'RD$2,750'),
  (186, 'Her Confession', 'RD$3,550', 'RD$3,750'),
  (187, 'His Confession', 'RD$3,550', 'RD$3,750'),
  (191, 'Ishq Al Shuyukh Silver', 'RD$3,050', 'RD$3,250'),
  (192, 'Ishq Al Shuyukh Gold', 'RD$3,050', 'RD$3,250'),
  (196, 'Issey Miyake Sport', 'RD$3,350', 'RD$4,550'),
  (206, 'JPG Le Male Le Parfum 2.5 EDP Men', 'RD$7,750', 'RD$7,850'),
  (210, 'Joop Homme EDT 4.2 EDT Men', 'RD$2,950', 'RD$3,050'),
  (211, 'Lattafa Khamrah', 'RD$2,850', 'RD$2,950'),
  (212, 'Lattafa Khamrah Dukhan', 'RD$3,250', 'RD$3,550'),
  (220, 'Maison Alhambra Delilah', 'RD$2,550', 'RD$2,750'),
  (238, 'Lattafa Haya', 'RD$2,700', 'RD$2,850'),
  (239, 'Lattafa Hayaati Gold', 'RD$2,450', 'RD$2,750'),
  (244, 'Lattafa Mayar Women', 'RD$2,850', 'RD$2,950'),
  (245, 'Lattafa Mayar Cherry Intense', 'RD$2,850', 'RD$3,050'),
  (246, 'Lattafa Mayar Natural Intense', 'RD$2,850', 'RD$2,950'),
  (247, 'Lattafa Musamam White Intense', 'RD$3,350', 'RD$3,650'),
  (251, 'Lattafa Pride Art Of Nature II', 'RD$3,350', 'RD$3,650'),
  (256, 'Lattafa The Kingdom Men', 'RD$2,850', 'RD$3,050'),
  (257, 'Lattafa Pride Art Of Universe', 'RD$3,550', 'RD$3,850'),
  (259, 'Lattafa The Kingdom Women', 'RD$2,850', 'RD$3,050'),
  (260, 'Lattafa Pride Nebras', 'RD$3,000', 'RD$3,250'),
  (262, 'Lattafa Pride Vintage Radio', 'RD$2,850', 'RD$3,050'),
  (263, 'Lattafa Qaed Al Fursan', 'RD$2,450', 'RD$2,550'),
  (264, 'Lattafa Qaed Al Fursan Unlimited', 'RD$2,550', 'RD$2,750'),
  (269, 'Lattafa Rave Now Black', 'RD$2,550', 'RD$2,650'),
  (270, 'Lattafa Rave Now', 'RD$2,550', 'RD$2,650'),
  (271, 'Zimaya Fatima Pink', 'RD$2,850', 'RD$2,950'),
  (277, 'Maison Alhambra Jean Lowe Inmortal', 'RD$2,750', 'RD$3,050'),
  (280, 'Maison Alhambra La Voie', 'RD$2,550', 'RD$2,750'),
  (281, 'Maison Alhambra Salvo', 'RD$2,550', 'RD$2,750'),
  (284, 'Mont Blanc Explorer Platinum', 'RD$3,750', 'RD$4,350'),
  (288, 'Givenchy Pi Men', 'RD$4,350', 'RD$4,550'),
  (292, 'Moschino Toy 2', 'RD$4,450', 'RD$4,550'),
  (293, 'Moschino Toy 2 Bubble Gum', 'RD$4,450', 'RD$4,550'),
  (295, 'Moschino Toy Boy', 'RD$4,450', 'RD$4,550'),
  (298, 'Nautica Voyage', 'RD$2,250', 'RD$2,350'),
  (299, 'Nitro Red Intensely', 'RD$3,650', 'RD$4,150'),
  (317, 'Rasasi Hawas Ice', 'RD$3,850', 'RD$4,050'),
  (321, 'Rasasi Hawas Malibu', 'RD$3,750', 'RD$3,950'),
  (326, 'Rasasi Hawas Tropical', 'RD$3,950', 'RD$4,150'),
  (385, 'Valentino Born In Roma Coral Fantasy', 'RD$8,950', 'RD$9,150'),
  (388, 'Valentino Born In Roma Intense Women', 'RD$10,450', 'RD$10,350'),
  (394, 'Versace Dylan Blue EDT', 'RD$5,150', 'RD$6,150'),
  (395, 'Versace Eros EDT Men', 'RD$4,650', 'RD$5,250'),
  (396, 'Versace Eros Eu De Parfum Men', 'RD$5,950', 'RD$6,150'),
  (397, 'Versace Eros Parfum Men', 'RD$6,150', 'RD$6,450'),
  (405, 'Yara Elixir EDP', 'RD$3,550', 'RD$3,950'),
  (420, '9PM Out Night', 'RD$4,150', 'RD$4,350'),
  (426, 'Dumont Nitro Elixir Men', 'RD$3,950', 'RD$4,150'),
  (427, 'Dumont Nitro Gold', 'RD$3,950', 'RD$4,150'),
  (436, 'Lattafa Al Noble Ameer', 'RD$2,850', 'RD$2,950'),
  (437, 'Lattafa Al Noble Safeer', 'RD$2,850', 'RD$2,950'),
  (438, 'Lattafa Al Noble Wazeer', 'RD$2,850', 'RD$2,950'),
  (459, 'Bharara Mast Rome Ivory pour Femme', 'RD$3,050', 'RD$3,350'),
  (460, 'Bharara Mast Rome Lucky', 'RD$3,550', 'RD$3,350'),
  (496, 'Set Versace Eros Flame 3PCS', 'RD$5,950', 'RD$6,450'),
  (511, 'Rabanne 1 Million Black EDP Men', 'RD$7,750', 'RD$9,350'),
  (513, 'Paco One Million Lucky EDT Men', 'RD$7,450', 'RD$7,750'),
  (519, 'Armaf Club de Nuit Oud', 'RD$3,250', 'RD$3,650');

-- Copia de cómo estaban (solo la primera vez y solo los que se van a cambiar), para poder deshacer.
create table if not exists private.precios_antes_20261110 (
  id bigint primary key, price text not null, original_price text, offer_label text, offer_ends_at timestamptz,
  availability text not null, guardado timestamptz not null default now()
);
revoke all on private.precios_antes_20261110 from public, anon, authenticated;
insert into private.precios_antes_20261110 (id, price, original_price, offer_label, offer_ends_at, availability)
select p.id, p.price, p.original_price, p.offer_label, p.offer_ends_at, p.availability
  from public.products p join cambios c using (id), modo m
 where not m.deshacer and lower(p.name) = lower(c.nombre) and p.price = c.antes and p.original_price is null
on conflict (id) do nothing;

with hechos as (
  update public.products p
     set price = c.ahora, updated_at = now()
    from cambios c, modo m
   where not m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre)
     and p.price = c.antes and p.original_price is null
  returning p.id
)
insert into resumen
select 1, 'Precios cambiados con el catálogo de noviembre', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where not m.deshacer and p.price = c.ahora and p.original_price is null),
       (select count(*) from cambios, modo m where not m.deshacer);

with hechos as (
  update public.products p
     set price = b.price, original_price = b.original_price, offer_label = b.offer_label,
         offer_ends_at = b.offer_ends_at, availability = b.availability, updated_at = now()
    from cambios c join private.precios_antes_20261110 b using (id), modo m
   where m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre) and p.price = c.ahora and p.original_price is null
  returning p.id
)
insert into resumen
select 1, 'Precios devueltos a como estaban (deshacer)', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where m.deshacer and p.price = c.antes and p.original_price is null),
       (select count(*) from cambios, modo m where m.deshacer);

-- 2) Resultado. «sin_cambiar» = perfumes que no se tocaron; debajo dice cuáles y por qué.
select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total
  from (
    select orden, cambio, hechos_ahora, ya_estaban, total from resumen
    union all
    select 2, 'No se tocó #' || c.id || ' ' || c.nombre || ': ' ||
              case when p.id is null then 'ya no está en tu tienda'
                   when lower(p.name) <> lower(c.nombre) then 'en tu tienda se llama «' || p.name || '»'
                   when p.original_price is not null then 'tiene una oferta puesta (' || p.price || ', antes ' || p.original_price || ')'
                   else 'en tu tienda dice ' || p.price || ' y este archivo esperaba ' || c.antes end,
           null, null, null
      from cambios c left join public.products p using (id), modo m
     where p.id is null or lower(p.name) <> lower(c.nombre) or p.original_price is not null
        or case when m.deshacer then p.price <> c.antes and not (p.price = c.ahora and exists (select 1 from private.precios_antes_20261110 b where b.id = c.id))
                else p.price <> c.antes and p.price <> c.ahora end
  ) r
 order by orden, cambio;

-- La primera vez verás «hechos_ahora» con los precios. Si lo repites: todo en «ya_estaban».
-- FIN
