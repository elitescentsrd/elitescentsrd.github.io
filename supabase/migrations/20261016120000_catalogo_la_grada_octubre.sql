-- CATÁLOGO DE LA GRADA DE OCTUBRE — 16 de octubre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Agrega 42 perfumes del catálogo de La Grada del 11 de octubre que no estaban en la tienda (números 497 a 538),
--      con precio, marca, tamaño, notas y foto. Los de RD$7,000 o más (22) quedan «Solo por encargo» (regla de siempre).
--      6 todavía no tienen notas confirmadas: salen sin notas hasta que las escribas en el panel.
--   2. Cambia el precio de 37 perfumes porque cambió lo que cuestan en La Grada (misma fórmula de ganancia de
--      siempre). En 3 de ellos termina la oferta, porque con el costo nuevo ese precio ya no deja ganancia.
--      El Bond No. 9 Greenwich Village vuelve a estar a la venta (estaba «Agotado» y La Grada lo tiene otra vez).
--   3. Guarda una copia de cómo estaban esos precios antes (private.precios_antes_20261016), para poder deshacer.
--
-- Lo que cambiaste a mano en el panel se respeta: un precio solo se cambia si sigue igual al de antes del catálogo.
-- Al final verás una tabla con lo que se hizo y, si alguno no se tocó, cuál y por qué.
--
-- Requisitos: el script del 30 de septiembre (FUNCIONES NUEVAS Y PERFUMES NUEVOS) ya aplicado.
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- CATÁLOGO DE LA GRADA DE OCTUBRE» y la última dice «-- FIN».
--
-- Es seguro repetirlo: lo que ya está hecho no se repite.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo. Quita los perfumes
-- nuevos (los que siguen con el mismo nombre) y devuelve los precios, las ofertas y la disponibilidad de antes (solo
-- donde el precio sigue siendo el que puso este archivo).

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'No existe private.is_store_admin(): aplica antes la migración de administrador. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'original_price') then
    raise exception 'Falta la migración de ofertas (20260921121000_ofertas.sql). No se cambió nada.';
  end if;
  if not exists (select 1 from public.products where id between 421 and 496) then
    raise exception 'Primero aplica el script del 30 de septiembre (20260930120000_funciones_y_perfumes_nuevos.sql). No se cambió nada.';
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

-- 1) Perfumes nuevos.
create temp table nuevos (
  id bigint primary key, name text not null, brand text not null, price text not null, size text not null, gender text not null,
  notes_top text[] not null, notes_heart text[] not null, notes_base text[] not null, sort_order int not null
) on commit drop;
insert into nuevos (id, name, brand, price, size, gender, notes_top, notes_heart, notes_base, sort_order) values
  (497, 'Armani Power of You EDP Women', 'Giorgio Armani', 'RD$9,350', '90 ML', 'mujer', array['Maracuyá', 'Naranja amarga', 'Limón']::text[], array['Frangipani', 'Notas solares']::text[], array['Vainilla de Madagascar', 'Benjuí', 'Láudano']::text[], 496),
  (498, 'Armani Stronger With You Spices EDP', 'Giorgio Armani', 'RD$10,050', '100 ML', 'hombre', array['Pimienta negra', 'Bergamota', 'Mandarina']::text[], array['Azafrán', 'Lavanda', 'Clavo', 'Canela']::text[], array['Vainilla Bourbon', 'Castaña', 'Ámbar']::text[], 497),
  (499, 'Azzaro Wanted Girl EDP', 'Azzaro', 'RD$6,050', '80 ML', 'mujer', array['Flor de azahar', 'Granada']::text[], array['Flor de jengibre', 'Datura', 'Jengibre']::text[], array['Haba tonka', 'Vainilla', 'Vetiver', 'Dulce de leche']::text[], 498),
  (500, 'Dolce & Gabbana Devotion EDP Intense', 'Dolce & Gabbana', 'RD$6,450', '100 ML', 'mujer', array['Avellana']::text[], array['Flor de azahar']::text[], array['Vainilla de Madagascar']::text[], 499),
  (501, 'Dolce & Gabbana Light Blue Capri in Love', 'Dolce & Gabbana', 'RD$5,750', '100 ML', 'mujer', array['Té de jazmín']::text[], array['Manzana verde']::text[], array['Longoza']::text[], 500),
  (502, 'Hugo Boss Dark Blue EDT', 'Hugo', 'RD$3,950', '75 ML', 'hombre', array['Jengibre', 'Toronja', 'Lima', 'Limón']::text[], array['Cardamomo', 'Geranio', 'Salvia']::text[], array['Vainilla', 'Pachulí', 'Maderas']::text[], 501),
  (503, 'JPG Divine Collector Edition', 'Jean Paul Gaultier', 'RD$8,350', '100 ML', 'mujer', array['Notas marinas', 'Bergamota', 'Frutos rojos']::text[], array['Lirio', 'Ylang-ylang', 'Jazmín']::text[], array['Merengue', 'Almizcle', 'Pachulí']::text[], 502),
  (504, 'JPG La Belle Rosea EDP', 'Jean Paul Gaultier', 'RD$10,050', '100 ML', 'mujer', array['Acorde acuático']::text[], array['Peonía']::text[], array['Vainilla']::text[], 503),
  (505, 'JPG Scandal Intense EDP Women', 'Jean Paul Gaultier', 'RD$7,950', '80 ML', 'mujer', array['Cardamomo']::text[], array['Ylang-ylang']::text[], array['Vainilla']::text[], 504),
  (506, 'JPG Scandal Pour Homme Intense EDP Men', 'Jean Paul Gaultier', 'RD$7,550', '100 ML', 'hombre', array['Salvia esclarea']::text[], array['Cuero']::text[], array['Vetiver']::text[], 505),
  (507, 'Jimmy Choo I Want Choo Forever EDP', 'Jimmy Choo', 'RD$6,550', '100 ML', 'mujer', array['Rosa', 'Pimienta rosa', 'Almendra amarga']::text[], array['Licor de cereza negra', 'Jazmín sambac', 'Vetiver']::text[], array['Musgo', 'Vainilla', 'Haba tonka']::text[], 506),
  (508, 'Moschino Toy 2 Gummy', 'Moschino', 'RD$6,550', '100 ML', 'unisex', array['Bergamota', 'Naranja sanguina', 'Avellana']::text[], array['Akigalawood', 'Praliné', 'Crema de leche']::text[], array['Benjuí', 'Mirra', 'Vainilla de Madagascar', 'Almizcle']::text[], 507),
  (509, 'Moschino Toy 2 Yummy', 'Moschino', 'RD$6,150', '100 ML', 'unisex', array['Mandarina', 'Bergamota', 'Incienso']::text[], array['Geranio', 'Jazmín sambac', 'Pimienta Timut', 'Pimienta negra']::text[], array['Rosa búlgara', 'Vetiver', 'Almizcle']::text[], 508),
  (510, 'Rabanne Fame The Couture Edition EDP', 'Paco Rabanne', 'RD$7,750', '80 ML', 'mujer', array[]::text[], array[]::text[], array[]::text[], 509),
  (511, 'Rabanne 1 Million Black EDP Men', 'Paco Rabanne', 'RD$7,750', '100 ML', 'hombre', array['Piña asada', 'Naranja sanguina', 'Cardamomo']::text[], array['Vainilla', 'Coco', 'Salvia esclarea']::text[], array['Ébano', 'Pachulí', 'Haba tonka']::text[], 510),
  (512, 'Paco Lady Million EDP Women', 'Paco Rabanne', 'RD$6,650', '80 ML', 'mujer', array['Neroli', 'Naranja amarga', 'Frambuesa']::text[], array['Flor de azahar', 'Jazmín']::text[], array['Miel', 'Pachulí', 'Ámbar']::text[], 511),
  (513, 'Paco One Million Lucky EDT Men', 'Paco Rabanne', 'RD$7,450', '100 ML', 'hombre', array['Notas ozónicas', 'Ciruela', 'Toronja', 'Bergamota']::text[], array['Avellana', 'Cedro', 'Madera de cachemira', 'Jazmín', 'Miel', 'Flor de azahar']::text[], array['Pachulí', 'Musgo de roble', 'Vetiver', 'Madera de ámbar']::text[], 512),
  (514, 'Valentino Donna Vendetta EDP Women', 'Valentino', 'RD$12,050', '100 ML', 'mujer', array['Naranja sanguina']::text[], array['Nardo']::text[], array['Sándalo']::text[], 513),
  (515, 'Valentino Uomo Born In Roma Yellow Dream EDT', 'Valentino', 'RD$8,450', '100 ML', 'hombre', array['Mandarina', 'Piña', 'Lima']::text[], array['Jengibre', 'Pan de jengibre', 'Especias']::text[], array['Vainilla', 'Cedro']::text[], 514),
  (516, 'YSL MYSLF Le Parfum Men', 'Yves Saint Laurent', 'RD$9,750', '100 ML', 'hombre', array['Pimienta negra', 'Bergamota', 'Canela', 'Cardamomo']::text[], array['Flor de azahar']::text[], array['Maderas', 'Vainilla Bourbon', 'Ámbar']::text[], 515),
  (517, 'Armaf Club de Nuit Intenso Fuego', 'Armaf', 'RD$5,050', '100 ML', 'hombre', array['Cítricos', 'Piña asada']::text[], array['Flores solares']::text[], array['Cedro']::text[], 516),
  (518, 'Armaf Club de Nuit Maleka', 'Armaf', 'RD$4,150', '100 ML', 'mujer', array['Lichi', 'Bergamota', 'Pimienta rosa']::text[], array['Geranio', 'Olíbano', 'Iris']::text[], array['Praliné', 'Ambroxan', 'Sándalo']::text[], 517),
  (519, 'Armaf Club de Nuit Oud', 'Armaf', 'RD$3,250', '105 ML', 'unisex', array['Melocotón', 'Pera', 'Maracuyá', 'Piña', 'Ciruela', 'Bergamota']::text[], array['Jazmín', 'Madera de cachemira', 'Fresia', 'Hojas de violeta']::text[], array['Almizcle', 'Ámbar', 'Vainilla', 'Oud']::text[], 518),
  (520, 'French Avenue Vulcan Baie', 'French Avenue', 'RD$4,350', '100 ML', 'unisex', array['Grosella negra', 'Mora', 'Bergamota', 'Romero']::text[], array['Frambuesa', 'Vodka', 'Lirio de los valles', 'Albahaca']::text[], array['Fresa', 'Melocotón', 'Sándalo', 'Incienso', 'Ámbar', 'Pachulí', 'Almizcle']::text[], 519),
  (521, 'Game of Spades Bluff', 'Game of Spades', 'RD$4,950', '100 ML', 'unisex', array['Pimienta rosa', 'Bergamota', 'Mandarina']::text[], array['Salvia esclarea', 'Grosella negra']::text[], array['Vetiver', 'Haba tonka']::text[], 520),
  (522, 'Game of Spades Full-House Refresh', 'Game of Spades', 'RD$5,350', '100 ML', 'unisex', array['Bergamota', 'Pepino', 'Sandía', 'Nuez moscada', 'Jengibre']::text[], array['Jazmín', 'Violeta', 'Vainilla Bourbon', 'Caramelo', 'Haba tonka']::text[], array['Ámbar gris', 'Semillas de ambreta', 'Incienso', 'Madera de guayaco', 'Almizcle blanco']::text[], 521),
  (523, 'Game of Spades Trick', 'Game of Spades', 'RD$4,950', '100 ML', 'unisex', array[]::text[], array[]::text[], array[]::text[], 522),
  (524, 'Lattafa Fakhar Platin', 'Lattafa', 'RD$2,750', '100 ML', 'unisex', array['Bergamota', 'Pimienta rosa', 'Cardamomo']::text[], array['Jengibre', 'Lavanda', 'Guayaba']::text[], array['Palo santo', 'Incienso', 'Sándalo']::text[], 523),
  (525, 'Acqua di Parma Fico di Amalfi EDT', 'Acqua di Parma', 'RD$11,150', '100 ML', 'unisex', array['Limón', 'Bergamota', 'Toronja']::text[], array['Néctar de higo', 'Pimienta rosa', 'Jazmín']::text[], array['Madera de higuera', 'Cedro', 'Benjuí']::text[], 524),
  (526, 'Acqua di Parma Fico di Amalfi La Riserva EDP', 'Acqua di Parma', 'RD$11,550', '100 ML', 'unisex', array['Mandarina', 'Naranja sanguina', 'Toronja', 'Limón']::text[], array['Iris', 'Higo', 'Limón']::text[], array['Haba tonka', 'Almizcle de ambreta', 'Notas ambaradas']::text[], 525),
  (527, 'Creed Aventus Cologne', 'Creed', 'RD$28,450', '100 ML', 'hombre', array['Mandarina', 'Jengibre', 'Pimienta rosa']::text[], array['Pachulí', 'Sándalo', 'Vetiver']::text[], array['Estoraque', 'Abedul', 'Almizcle', 'Haba tonka']::text[], 526),
  (528, 'Creed Original Santal', 'Creed', 'RD$24,650', '100 ML', 'unisex', array['Jengibre', 'Bayas de enebro', 'Bergamota', 'Romero', 'Cilantro', 'Mandarina']::text[], array['Lavanda', 'Geranio', 'Flor de azahar', 'Sándalo']::text[], array['Musgo de roble', 'Almizcle', 'Haba tonka', 'Cedro']::text[], 527),
  (529, 'Elivi Exotic Extrait de Parfum', 'Elivi', 'RD$11,750', '50 ML', 'unisex', array[]::text[], array[]::text[], array[]::text[], 528),
  (530, 'Elivi Mor Extrait de Parfum', 'Elivi', 'RD$12,550', '50 ML', 'unisex', array[]::text[], array[]::text[], array[]::text[], 529),
  (531, 'Elivi Unstoppable Hong Kong', 'Elivi', 'RD$11,250', '50 ML', 'unisex', array[]::text[], array[]::text[], array[]::text[], 530),
  (532, 'Parfums de Marly Perseus', 'Parfums de Marly', 'RD$15,850', '125 ML', 'hombre', array['Bergamota', 'Toronja', 'Brote de grosella negra']::text[], array['Vetiver', 'Mandarina verde', 'Geranio']::text[], array['Maderas secas', 'Madera de cachemira', 'Ámbar gris']::text[], 531),
  (533, 'Tom Ford Eau de Soleil Blanc EDT', 'Tom Ford', 'RD$11,650', '100 ML', 'unisex', array['Bergamota', 'Naranja amarga']::text[], array['Petitgrain', 'Ylang-ylang']::text[], array['Pistacho', 'Coco de mar']::text[], 532),
  (534, 'Tom Ford F***ing Fabulous EDP', 'Tom Ford', 'RD$29,850', '100 ML', 'unisex', array['Salvia esclarea', 'Lavanda']::text[], array['Almendra amarga', 'Vainilla', 'Cuero', 'Iris']::text[], array['Haba tonka', 'Cashmeran', 'Ámbar', 'Maderas claras']::text[], 533),
  (535, 'Set Afnan 9 AM Pour Femme', 'Sets', 'RD$3,950', '100 ML', 'mujer', array['Mandarina', 'Toronja', 'Bergamota']::text[], array['Frambuesa', 'Grosella negra']::text[], array['Almizcle', 'Ámbar', 'Naranja']::text[], 534),
  (536, 'Set Calvin Klein CK One 3PCS', 'Sets', 'RD$4,850', '100 ML', 'unisex', array['Limón', 'Notas verdes', 'Bergamota']::text[], array['Lirio de los valles', 'Jazmín', 'Violeta']::text[], array['Green Accord', 'Almizcle', 'Cedro']::text[], 535),
  (537, 'Set Jean Paul Gaultier Miniatures 4PCS', 'Sets', 'RD$5,750', '4 x 7 ML', 'unisex', array[]::text[], array[]::text[], array[]::text[], 536),
  (538, 'Set Lattafa Pride Vintage Radio', 'Sets', 'RD$3,050', '100 ML', 'unisex', array['Lavanda', 'Salvia', 'Bergamota']::text[], array['Ciruela', 'Palo Santo', 'Pimienta negra']::text[], array['Sándalo', 'Oud']::text[], 537);

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
  insert into public.products (id, name, brand, price, size, gender, availability, notes_top, notes_heart, notes_base, sort_order, active)
  overriding system value
  select n.id, n.name, n.brand, n.price, n.size, n.gender, 'disponible', n.notes_top, n.notes_heart, n.notes_base, n.sort_order, true
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
select 1, 'Perfumes nuevos quitados (deshacer)', (select count(*) from hechos),
       (select count(*) from nuevos n, modo m where m.deshacer and not exists (select 1 from public.products p where p.id = n.id)),
       (select count(*) from nuevos, modo m where m.deshacer);

-- Que el panel siga numerando después del último perfume.
select setval(pg_get_serial_sequence('public.products', 'id'), greatest((select max(id) from public.products), 1));

-- 2) Precios que cambian con el catálogo nuevo. «antes» y «oferta_antes» son el precio y el precio tachado de hoy;
--    si en tu tienda dice otra cosa (lo cambiaste en el panel), ese perfume no se toca.
create temp table cambios (
  id bigint primary key, nombre text not null, antes text not null, oferta_antes text, ahora text not null, reactivar boolean not null
) on commit drop;
insert into cambios (id, nombre, antes, oferta_antes, ahora, reactivar) values
  (17, 'Afeef EDP Unisex', 'RD$3,350', null, 'RD$3,750', false),
  (47, 'Armaf Club de Nuit Women', 'RD$2,850', null, 'RD$2,950', false),
  (49, 'Armaf Club de Nuit Impériale', 'RD$3,450', null, 'RD$3,650', false),
  (55, 'Armaf Club de Nuit Urban Elixir', 'RD$3,450', null, 'RD$3,650', false),
  (64, 'Armaf Odyssey Aqua', 'RD$2,850', null, 'RD$3,050', false),
  (68, 'Armaf Odyssey Candee Woman', 'RD$2,850', null, 'RD$3,050', false),
  (70, 'Armaf Odyssey Homme', 'RD$2,850', null, 'RD$3,050', false),
  (71, 'Armaf Odyssey Homme White', 'RD$2,850 / RD$3,250', null, 'RD$3,050 / RD$3,650', false),
  (74, 'Armaf Odyssey Mega', 'RD$2,850', null, 'RD$3,050', false),
  (79, 'Armaf Odyssey Tyrant', 'RD$2,850', null, 'RD$3,050', false),
  (89, 'Lattafa Atlas', 'RD$3,050', null, 'RD$3,250', false),
  (95, 'Lattafa Bade''e Al Oud Honor & Glory', 'RD$2,750', null, 'RD$2,850', false),
  (111, 'Bond No. 9 Greenwich Village', 'RD$15,200', null, 'RD$16,750', true),
  (114, 'Calvin Klein Eternity Women', 'RD$3,950', null, 'RD$4,350', false),
  (142, 'Dumont Nitro Red', 'RD$3,350', null, 'RD$3,550', false),
  (156, 'French Avenue Liquid Brun', 'RD$3,050', null, 'RD$3,150', false),
  (221, 'Lattafa Asad Bourbon', 'RD$2,550', 'RD$2,750', 'RD$2,750', false),
  (229, 'Lattafa Fakhar Men', 'RD$2,450', null, 'RD$2,550', false),
  (230, 'Lattafa Fakhar Women', 'RD$2,450', null, 'RD$2,550', false),
  (231, 'Lattafa Fakhar Gold Extrait', 'RD$2,550', null, 'RD$2,750', false),
  (257, 'Lattafa Pride Art Of Universe', 'RD$3,400', null, 'RD$3,550', false),
  (286, 'Mont Blanc Explorer EDP', 'RD$4,350', null, 'RD$5,050', false),
  (294, 'Moschino Toy 2 Pearl', 'RD$4,450', null, 'RD$4,950', false),
  (323, 'Rasasi Hawas Elixir Men', 'RD$3,550', null, 'RD$3,950', false),
  (324, 'Rasasi Hawas Fire Men', 'RD$3,550', null, 'RD$3,950', false),
  (402, 'Blue Chanel', 'RD$12,350', 'RD$12,700', 'RD$15,150', false),
  (404, 'Yara Candy EDP Women', 'RD$2,750', null, 'RD$2,950', false),
  (405, 'Yara Elixir EDP', 'RD$3,050', 'RD$3,450', 'RD$3,550', false),
  (426, 'Dumont Nitro Elixir Men', 'RD$4,750', null, 'RD$3,950', false),
  (427, 'Dumont Nitro Gold', 'RD$4,550', null, 'RD$3,950', false),
  (433, 'French Avenue Liquid Brun Limited Edition', 'RD$5,450', null, 'RD$4,850', false),
  (436, 'Lattafa Al Noble Ameer', 'RD$2,750', null, 'RD$2,850', false),
  (437, 'Lattafa Al Noble Safeer', 'RD$2,750', null, 'RD$2,850', false),
  (438, 'Lattafa Al Noble Wazeer', 'RD$2,750', null, 'RD$2,850', false),
  (443, 'Lattafa Khamrah Waha', 'RD$4,150', null, 'RD$3,050', false),
  (455, 'Rayhaan Pacific Aloha', 'RD$3,050', null, 'RD$3,550', false),
  (480, 'Parfums de Marly Layton', 'RD$15,050', null, 'RD$17,250', false);

-- Copia de cómo estaban (solo la primera vez y solo los que se van a cambiar), para poder deshacer.
create table if not exists private.precios_antes_20261016 (
  id bigint primary key, price text not null, original_price text, offer_label text, offer_ends_at timestamptz,
  availability text not null, guardado timestamptz not null default now()
);
revoke all on private.precios_antes_20261016 from public, anon, authenticated;
insert into private.precios_antes_20261016 (id, price, original_price, offer_label, offer_ends_at, availability)
select p.id, p.price, p.original_price, p.offer_label, p.offer_ends_at, p.availability
  from public.products p join cambios c using (id), modo m
 where not m.deshacer and lower(p.name) = lower(c.nombre)
   and p.price = c.antes and p.original_price is not distinct from c.oferta_antes
on conflict (id) do nothing;

with hechos as (
  update public.products p
     set price = c.ahora,
         original_price = null,
         availability = case when c.reactivar and p.availability = 'agotado' then 'disponible' else p.availability end,
         updated_at = now()
    from cambios c, modo m
   where not m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre)
     and p.price = c.antes and p.original_price is not distinct from c.oferta_antes
  returning p.id
)
insert into resumen
select 2, 'Precios cambiados con el catálogo nuevo', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where not m.deshacer and p.price = c.ahora and p.original_price is null),
       (select count(*) from cambios, modo m where not m.deshacer);

with hechos as (
  update public.products p
     set price = b.price,
         original_price = b.original_price,
         offer_label = b.offer_label,
         offer_ends_at = b.offer_ends_at,
         availability = b.availability,
         updated_at = now()
    from cambios c join private.precios_antes_20261016 b using (id), modo m
   where m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre) and p.price = c.ahora and p.original_price is null
  returning p.id
)
insert into resumen
select 2, 'Precios devueltos a como estaban (deshacer)', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where m.deshacer and p.price = c.antes and p.original_price is not distinct from c.oferta_antes),
       (select count(*) from cambios, modo m where m.deshacer);

-- 3) Resultado. «sin_cambiar» = perfumes que no se tocaron; debajo dice cuáles y por qué.
select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total
  from (
    select orden, cambio, hechos_ahora, ya_estaban, total from resumen
    union all
    select 3, 'No se tocó #' || c.id || ' ' || c.nombre || ': ' ||
              case when p.id is null then 'ya no está en tu tienda'
                   when lower(p.name) <> lower(c.nombre) then 'en tu tienda se llama «' || p.name || '»'
                   else 'en tu tienda dice ' || p.price || coalesce(' (antes ' || p.original_price || ')', '') ||
                        ' y este archivo esperaba ' || c.antes || coalesce(' (antes ' || c.oferta_antes || ')', '') end,
           null, null, null
      from cambios c left join public.products p using (id), modo m
     where p.id is null or lower(p.name) <> lower(c.nombre)
        or case when m.deshacer then not (p.price = c.antes and p.original_price is not distinct from c.oferta_antes)
                                     and not (p.price = c.ahora and p.original_price is null and exists (select 1 from private.precios_antes_20261016 b where b.id = c.id))
                else not (p.price = c.antes and p.original_price is not distinct from c.oferta_antes)
                     and not (p.price = c.ahora and p.original_price is null) end
  ) r
 order by orden, cambio;

-- La primera vez verás «hechos_ahora» con los perfumes nuevos y los precios. Si lo repites: todo en «ya_estaban».
-- FIN
