-- PRECIOS NUEVOS CON MÁS GANANCIA — 10 de noviembre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Pone el precio nuevo a 442 perfumes: los costos del segundo catálogo de La Grada de noviembre con tu fórmula
--      nueva de ganancia (más margen para reinvertir) y la estrategia de cada perfume. Reemplaza al script de precios de
--      noviembre (20261110120000): sirve tanto si ya aplicaste ese como si no.
--      Los que llegan a RD$7,000 o más quedan «Solo por encargo» (regla de siempre).
--   2. Guarda una copia de cómo estaban esos precios (private.precios_antes_margen_20261110), para poder deshacer.
--
-- Lo que cambiaste a mano en el panel se respeta: un precio solo se cambia si sigue igual al de hoy (o al que puso el
-- script de noviembre).
-- Al final verás una tabla con lo que se hizo y, si alguno no se tocó, cuál y por qué.
-- Este archivo NO trae costos: tus costos nuevos van en tu archivo privado (no está en GitHub).
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- PRECIOS NUEVOS CON MÁS GANANCIA» y la última dice «-- FIN».
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

-- 1) Precios que cambian. «antes» es el precio de hoy en tu tienda y «antes_nov» el que puso el script de noviembre (si
--    lo aplicaste); si dice otra cosa (lo cambiaste en el panel), ese perfume no se toca.
create temp table cambios (
  id bigint primary key, nombre text not null, antes text not null, antes_nov text, ahora text not null
) on commit drop;
insert into cambios (id, nombre, antes, antes_nov, ahora) values
  (1, '212 Sexy EDT Men', 'RD$5,150', 'RD$5,250', 'RD$5,550'),
  (2, '212 VIP EDT NY Men', 'RD$6,150', null, 'RD$6,450'),
  (5, '212 VIP Rosé EDP Women', 'RD$7,850', null, 'RD$8,950'),
  (6, '360 Collection For Men EDT', 'RD$3,950', null, 'RD$4,450'),
  (7, '360 Red EDP Women', 'RD$3,350', null, 'RD$3,850'),
  (8, '360 Red EDP Men', 'RD$3,350', null, 'RD$3,850'),
  (9, '360 White EDT Women', 'RD$3,350', null, 'RD$3,850'),
  (10, '9 AM Dive Blue EDP Men Afnan', 'RD$2,750', 'RD$2,850', 'RD$3,050'),
  (11, '9 PM EDP Men Afnan', 'RD$2,750', 'RD$2,950', 'RD$3,350'),
  (12, '9 PM Elixir Men Afnan', 'RD$3,600', 'RD$4,150', 'RD$4,750'),
  (13, '9 PM Rebel Men Afnan', 'RD$3,350', 'RD$3,550', 'RD$4,050'),
  (15, 'Acqua di Giò EDT Men', 'RD$5,750', null, 'RD$6,050'),
  (16, 'Acqua di Giò Profondo EDP Men', 'RD$6,950', 'RD$8,050', 'RD$8,350'),
  (17, 'Afeef EDP Unisex', 'RD$3,750', null, 'RD$4,250'),
  (18, 'Afnan Rare Carbon', 'RD$3,050', null, 'RD$3,550'),
  (20, 'Lattafa Tharwah Silver', 'RD$3,250', null, 'RD$3,750'),
  (22, 'Afnan Zimaya Tiramisu Coco', 'RD$3,350', null, 'RD$3,850'),
  (23, 'Lattafa Winners Trophy Silver', 'RD$3,050', null, 'RD$3,350'),
  (25, 'Jean Lowe Azure EDP Spray', 'RD$3,050', null, 'RD$3,550'),
  (26, 'Jean Lowe Vibe EDP Spray', 'RD$3,050', null, 'RD$3,550'),
  (28, 'Al Haramain Gold Edition', 'RD$3,450 / RD$4,150', null, 'RD$3,850 / RD$4,650'),
  (29, 'Al Haramain Ruby', 'RD$3,950 / RD$4,350', null, 'RD$4,450 / RD$4,950'),
  (30, 'Al Haramain White', 'RD$3,550', null, 'RD$4,050'),
  (31, 'Al Haramain Aqua Dubai', 'RD$3,950', null, 'RD$4,450'),
  (32, 'Emper Aruba Tonka', 'RD$2,750', null, 'RD$3,150'),
  (33, 'Ana Abiyedh Coral EDP Spray', 'RD$2,650', 'RD$2,750', 'RD$3,150'),
  (34, 'Ariana Grande Thank U Next', 'RD$4,350', 'RD$5,150', 'RD$5,850'),
  (35, 'Ariana Grande Ari', 'RD$5,050', null, 'RD$5,750'),
  (37, 'Ariana Grande Cloud Intense 2.0', 'RD$5,050', null, 'RD$5,250'),
  (38, 'Ariana Grande Cloud Pink', 'RD$5,050', null, 'RD$5,750'),
  (39, 'Ariana Grande Moonlight', 'RD$4,350', null, 'RD$4,950'),
  (40, 'Ariana Grande Sweet Like Candy', 'RD$4,350', null, 'RD$4,950'),
  (41, 'Armaf Beach Party', 'RD$3,550', null, 'RD$4,050'),
  (43, 'Armaf Club de Nuit Précieux I', 'RD$4,550', 'RD$4,750', 'RD$5,350'),
  (46, 'Armaf Club de Nuit Précieux IV', 'RD$4,550', 'RD$4,750', 'RD$5,350'),
  (47, 'Armaf Club de Nuit Women', 'RD$2,950', null, 'RD$3,350'),
  (48, 'Armaf Club de Nuit Blue Iconic', 'RD$3,650', null, 'RD$4,250'),
  (49, 'Armaf Club de Nuit Impériale', 'RD$3,650', null, 'RD$4,250'),
  (50, 'Armaf Club de Nuit Intense Men', 'RD$2,750', 'RD$2,950', 'RD$3,350'),
  (52, 'Armaf Club de Nuit Milestone', 'RD$3,450', null, 'RD$3,950'),
  (53, 'Armaf Club de Nuit Sillage', 'RD$3,450', null, 'RD$3,950'),
  (54, 'Armaf Club de Nuit Untold', 'RD$3,450', null, 'RD$3,650'),
  (55, 'Armaf Club de Nuit Urban Elixir', 'RD$3,650', null, 'RD$4,250'),
  (57, 'Armaf Island Bliss Delights', 'RD$3,900', 'RD$4,450', 'RD$5,150'),
  (58, 'Armaf Yum Yum', 'RD$3,900', 'RD$4,450', 'RD$5,150'),
  (59, 'Armaf Island Bon Bon Delights', 'RD$3,900', 'RD$4,450', 'RD$5,150'),
  (60, 'Armaf Island Breeze Delights', 'RD$3,900', 'RD$4,450', 'RD$5,150'),
  (61, 'Armaf Miss Attitude', 'RD$3,350', null, 'RD$3,850'),
  (62, 'Armaf Odyssey Mandarin Elixir', 'RD$3,050', 'RD$3,350', 'RD$3,650'),
  (63, 'Armaf Odyssey Aoud Edition', 'RD$2,850', 'RD$3,050', 'RD$3,550'),
  (64, 'Armaf Odyssey Aqua', 'RD$3,050', null, 'RD$3,550'),
  (65, 'Armaf Odyssey Artisto', 'RD$3,300', 'RD$3,450', 'RD$3,750'),
  (66, 'Armaf Odyssey Bahamas', 'RD$3,400', 'RD$3,450', 'RD$3,750'),
  (67, 'Armaf Odyssey Black Forest', 'RD$3,400', 'RD$3,950', 'RD$4,450'),
  (68, 'Armaf Odyssey Candee Woman', 'RD$3,050', null, 'RD$3,550'),
  (70, 'Armaf Odyssey Homme', 'RD$3,050', null, 'RD$3,550'),
  (71, 'Armaf Odyssey Homme White', 'RD$2,850 / RD$3,650', 'RD$3,050 / RD$3,650', 'RD$3,550 / RD$4,250'),
  (72, 'Armaf Odyssey Limoni', 'RD$3,050', null, 'RD$3,550'),
  (73, 'Armaf Odyssey Mandarin Sky', 'RD$2,750', 'RD$2,950', 'RD$3,350'),
  (74, 'Armaf Odyssey Mega', 'RD$3,050', null, 'RD$3,550'),
  (75, 'Armaf Odyssey Montagne', 'RD$3,550', null, 'RD$4,050'),
  (76, 'Armaf Odyssey Revolution', 'RD$3,750', null, 'RD$4,250'),
  (77, 'Armaf Odyssey Spectra', 'RD$3,050', null, 'RD$3,550'),
  (78, 'Armaf Odyssey Toffee Coffee', 'RD$3,400', 'RD$3,950', 'RD$4,450'),
  (79, 'Armaf Odyssey Tyrant', 'RD$3,050', null, 'RD$3,550'),
  (80, 'Armaf Odyssey Wild One', 'RD$2,850', null, 'RD$3,250'),
  (82, 'Armani Stronger With You EDP', 'RD$8,450', null, 'RD$9,550'),
  (83, 'Armani Stronger With You EDT', 'RD$4,950', null, 'RD$5,250'),
  (86, 'Lattafa Asad Elixir', 'RD$3,400', null, 'RD$3,950'),
  (87, 'Lattafa Asad', 'RD$2,750', null, 'RD$2,950'),
  (88, 'Lattafa Asad Zanzibar', 'RD$2,750', null, 'RD$3,050'),
  (89, 'Lattafa Atlas', 'RD$3,250', 'RD$3,350', 'RD$3,850'),
  (90, 'Azzaro Most Wanted Toilette', 'RD$5,150', 'RD$5,250', 'RD$6,050'),
  (91, 'Azzaro Most Wanted EDP', 'RD$5,150', null, 'RD$5,850'),
  (92, 'Azzaro Most Wanted EDT Intense', 'RD$6,050', null, 'RD$6,850'),
  (93, 'Lattafa Bade''e Al Oud Amethyst', 'RD$2,750', null, 'RD$3,150'),
  (94, 'Lattafa Bade''e Al Oud For Glory', 'RD$2,550', null, 'RD$2,950'),
  (95, 'Lattafa Bade''e Al Oud Honor & Glory', 'RD$2,850', null, 'RD$3,150'),
  (96, 'Lattafa Bade''e Al Oud Sublime', 'RD$2,750', null, 'RD$3,150'),
  (97, 'Lattafa Bade''e Al Oud Noble Blush', 'RD$2,850', 'RD$3,050', 'RD$3,550'),
  (98, 'Bharara Champagne Black', 'RD$2,750', null, 'RD$3,150'),
  (99, 'Lolita Lempicka Women', 'RD$4,350', null, 'RD$4,950'),
  (100, 'Bharara Chocolate', 'RD$5,050', null, 'RD$5,750'),
  (102, 'Bharara King', 'RD$4,750', null, 'RD$5,150'),
  (103, 'Bharara Rome Paradox', 'RD$3,000', 'RD$3,350', 'RD$3,850'),
  (105, 'Bharara Rome Imagine', 'RD$3,000', 'RD$3,350', 'RD$3,850'),
  (106, 'Bharara Rome Pour Femme', 'RD$3,050', null, 'RD$3,550'),
  (107, 'Bharara Rome Pour Homme', 'RD$3,050', null, 'RD$3,550'),
  (108, 'Versace Blue Jeans Men', 'RD$3,250', null, 'RD$3,750'),
  (111, 'Bond No. 9 Greenwich Village', 'RD$16,750', null, 'RD$18,550'),
  (112, 'Britney Spears Fantasy EDP', 'RD$3,050', null, 'RD$3,550'),
  (113, 'Calvin Klein Eternity Men', 'RD$3,750', null, 'RD$4,250'),
  (114, 'Calvin Klein Eternity Women', 'RD$4,350', null, 'RD$4,950'),
  (115, 'Calvin Klein Obsession', 'RD$2,950', null, 'RD$3,350'),
  (116, 'Calvin Klein One', 'RD$2,950', null, 'RD$3,250'),
  (117, 'Carolina Herrera Bad Boy Cobalt Men', 'RD$5,850', null, 'RD$6,650'),
  (118, 'Carolina Herrera La Bomba', 'RD$10,350', 'RD$10,250', 'RD$11,450'),
  (119, 'Coach New York Wild Rose', 'RD$5,150', null, 'RD$5,850'),
  (120, 'Lattafa Confidential Platinum', 'RD$2,550', null, 'RD$2,850'),
  (121, 'Lattafa Confidential Private Gold', 'RD$2,550', null, 'RD$2,850'),
  (122, 'Diesel Plus Plus Man', 'RD$2,150', 'RD$1,650', 'RD$1,950'),
  (123, 'Diesel Plus Plus Women', 'RD$2,150', 'RD$1,650', 'RD$1,950'),
  (129, 'Dior Sauvage Men Antiguo EDT', 'RD$6,150', null, 'RD$6,950'),
  (130, 'Dior Sauvage EDT Men', 'RD$8,650', null, 'RD$9,550'),
  (131, 'Dior Sauvage Elixir', 'RD$10,550', null, 'RD$11,750'),
  (132, 'Dolce & Gabbana Devotion', 'RD$5,250', null, 'RD$6,050'),
  (133, 'Dolce & Gabbana Light Blue Men', 'RD$4,950', null, 'RD$5,550'),
  (134, 'Dolce & Gabbana Light Blue Women', 'RD$4,950', null, 'RD$5,550'),
  (135, 'Dolce & Gabbana The One', 'RD$4,950', null, 'RD$5,250'),
  (136, 'Dolce & Gabbana The One Gold Intense', 'RD$5,850', null, 'RD$6,650'),
  (138, 'Donna Intense Stallion', 'RD$3,050', null, 'RD$3,550'),
  (139, 'Dumont Nitro Blue', 'RD$3,350', null, 'RD$3,850'),
  (140, 'Dumont Nitro Platinum', 'RD$3,350', null, 'RD$3,850'),
  (141, 'Dumont Nitro Intense', 'RD$3,350', null, 'RD$3,850'),
  (142, 'Dumont Nitro Red', 'RD$3,550', null, 'RD$4,050'),
  (143, 'Dumont Nitro White Men', 'RD$3,350', null, 'RD$3,850'),
  (144, 'Lattafa Eclaire', 'RD$2,950', null, 'RD$3,050'),
  (146, 'Lattafa Emeer', 'RD$3,550', null, 'RD$4,050'),
  (147, 'Britney Spears Fantasy Circus Women', 'RD$3,050', null, 'RD$3,550'),
  (148, 'Lomani Paris Millionaire Spirit', 'RD$3,050', null, 'RD$3,550'),
  (152, 'French Avenue Aether Extrait', 'RD$3,950', null, 'RD$4,450'),
  (153, 'French Avenue Atlantis Extrait', 'RD$3,950', 'RD$4,350', 'RD$4,950'),
  (154, 'Barakkat Rouge 540 Red', 'RD$2,650', null, 'RD$3,050'),
  (155, 'Barakkat Rouge 540 Extrait EDP', 'RD$2,650', null, 'RD$3,050'),
  (156, 'French Avenue Liquid Brun', 'RD$3,150', null, 'RD$3,450'),
  (157, 'Game of Spades Bid', 'RD$5,350', null, 'RD$6,150'),
  (158, 'Game of Spades Blind Bid', 'RD$5,350', null, 'RD$6,050'),
  (159, 'Game of Spades Bonus', 'RD$5,150', null, 'RD$5,650'),
  (160, 'Game of Spades Boston', 'RD$4,900', null, 'RD$5,650'),
  (161, 'Game of Spades Diamond', 'RD$4,950', null, 'RD$5,650'),
  (162, 'Game of Spades Double Bonus', 'RD$5,300', null, 'RD$6,050'),
  (163, 'Game of Spades Emerald', 'RD$4,900', null, 'RD$5,650'),
  (164, 'Game of Spades Full House', 'RD$4,900', null, 'RD$5,650'),
  (166, 'Game of Spades High Roller', 'RD$4,900', null, 'RD$5,650'),
  (167, 'Game of Spades King', 'RD$4,950', null, 'RD$5,650'),
  (168, 'Game of Spades Moon', 'RD$4,900', null, 'RD$5,650'),
  (169, 'Game of Spades No Limit', 'RD$5,200', null, 'RD$5,650'),
  (171, 'Game of Spades Queen', 'RD$5,350', null, 'RD$6,050'),
  (172, 'Game of Spades Rouge Extrait', 'RD$4,950', null, 'RD$5,650'),
  (173, 'Game of Spades Rouge Parfum', 'RD$5,350', null, 'RD$6,050'),
  (174, 'Game of Spades Royale', 'RD$4,950', null, 'RD$5,650'),
  (176, 'Game of Spades Topaz', 'RD$5,350', null, 'RD$6,050'),
  (177, 'Game of Spades Wildcard', 'RD$4,950', null, 'RD$5,650'),
  (178, 'Game of Spades Win', 'RD$4,950', null, 'RD$5,650'),
  (179, 'Game of Spades Yellow Sapphire', 'RD$5,350', null, 'RD$6,050'),
  (180, 'Game of Spades All-In', 'RD$5,350', null, 'RD$6,050'),
  (181, 'Guess Seductive Homme Men', 'RD$3,050', null, 'RD$3,550'),
  (182, 'Guess Seductive Homme Men', 'RD$3,250', null, 'RD$3,750'),
  (183, 'Hayaati Black', 'RD$2,450', 'RD$2,750', 'RD$3,150'),
  (184, 'Hayaati Florence', 'RD$2,450', 'RD$2,750', 'RD$3,150'),
  (185, 'Hayaati Al Maleky', 'RD$2,450', 'RD$2,750', 'RD$3,150'),
  (186, 'Her Confession', 'RD$3,550', 'RD$3,750', 'RD$4,250'),
  (187, 'His Confession', 'RD$3,550', 'RD$3,750', 'RD$4,250'),
  (188, 'Hugo XY Men', 'RD$3,750', null, 'RD$4,250'),
  (191, 'Ishq Al Shuyukh Silver', 'RD$3,050', 'RD$3,250', 'RD$3,750'),
  (192, 'Ishq Al Shuyukh Gold', 'RD$3,050', 'RD$3,250', 'RD$3,750'),
  (193, 'Issey Miyake Intense', 'RD$4,550', null, 'RD$5,250'),
  (194, 'Issey Miyake L''Eau d''Issey', 'RD$4,550', null, 'RD$5,250'),
  (195, 'Issey Miyake Pour Homme', 'RD$4,950', null, 'RD$5,250'),
  (196, 'Issey Miyake Sport', 'RD$3,350', 'RD$4,550', 'RD$5,250'),
  (197, 'JPG Divine EDP Intense', 'RD$9,250', null, 'RD$10,450'),
  (198, 'JPG La Belle Paradise Garden', 'RD$8,250', null, 'RD$9,250'),
  (200, 'JPG Le Beau 4.2 EDT Men', 'RD$7,750', null, 'RD$8,750'),
  (201, 'JPG Le Beau Le Parfum 4.2 EDP', 'RD$8,450', null, 'RD$9,450'),
  (202, 'JPG Le Beau Paradise Garden', 'RD$9,150', null, 'RD$10,250'),
  (203, 'JPG Le Male 4.2 EDT Men', 'RD$7,750', null, 'RD$8,750'),
  (204, 'JPG Le Male Elixir 2.5 EDP Men', 'RD$7,850', null, 'RD$8,950'),
  (205, 'JPG Le Male Elixir 4.2 EDP Men', 'RD$8,250', null, 'RD$9,050'),
  (206, 'JPG Le Male Le Parfum 2.5 EDP Men', 'RD$7,750', 'RD$7,850', 'RD$8,950'),
  (207, 'JPG Scandal Le Parfum 3.4 EDP Men', 'RD$8,750', null, 'RD$9,850'),
  (208, 'JPG Ultra Male 4.2 Intense', 'RD$7,450', null, 'RD$7,750'),
  (209, 'JPG Le Beau Flower Edition', 'RD$8,550', null, 'RD$9,650'),
  (210, 'Joop Homme EDT 4.2 EDT Men', 'RD$2,950', 'RD$3,050', 'RD$3,550'),
  (211, 'Lattafa Khamrah', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (212, 'Lattafa Khamrah Dukhan', 'RD$3,250', 'RD$3,550', 'RD$4,050'),
  (213, 'Lattafa Khamrah Qahw', 'RD$3,050', null, 'RD$3,350'),
  (214, 'Lacoste L.12.12 Blanc, Pure White', 'RD$8,450', null, 'RD$9,450'),
  (215, 'Lancome La Vie Est Belle', 'RD$7,850', null, 'RD$8,250'),
  (216, 'Lancome La Vie Est Belle L''Elixir', 'RD$9,250', null, 'RD$10,450'),
  (219, 'Lattafa Angham', 'RD$3,650', null, 'RD$4,150'),
  (220, 'Maison Alhambra Delilah', 'RD$2,550', 'RD$2,750', 'RD$3,150'),
  (221, 'Lattafa Asad Bourbon', 'RD$2,750', null, 'RD$3,050'),
  (222, 'Coach New York Blue', 'RD$5,150', null, 'RD$5,850'),
  (227, 'Lattafa Eclaire Banoffi', 'RD$3,200', null, 'RD$3,550'),
  (228, 'Lattafa Eclaire Pistache', 'RD$3,200', null, 'RD$3,550'),
  (229, 'Lattafa Fakhar Men', 'RD$2,550', null, 'RD$2,950'),
  (230, 'Lattafa Fakhar Women', 'RD$2,550', null, 'RD$2,950'),
  (231, 'Lattafa Fakhar Gold Extrait', 'RD$2,750', null, 'RD$3,150'),
  (232, 'Lattafa Give Me Gourman Whipped Pleasure', 'RD$3,550', null, 'RD$4,050'),
  (233, 'Lattafa Give Me Gourmand Choco Overdose', 'RD$3,550', null, 'RD$4,050'),
  (234, 'Lattafa Give Me Gourman Cookie Crave', 'RD$3,550', null, 'RD$4,050'),
  (236, 'Lattafa Give Me Gourmand Vanilla Freak', 'RD$3,550', null, 'RD$4,050'),
  (237, 'Lattafa Habik For Men', 'RD$3,150', null, 'RD$3,550'),
  (238, 'Lattafa Haya', 'RD$2,700', 'RD$2,850', 'RD$3,250'),
  (239, 'Lattafa Hayaati Gold', 'RD$2,450', 'RD$2,750', 'RD$3,150'),
  (241, 'Lattafa La Collection D''Antiquites 1886', 'RD$3,550', null, 'RD$4,050'),
  (244, 'Lattafa Mayar Women', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (245, 'Lattafa Mayar Cherry Intense', 'RD$2,850', 'RD$3,050', 'RD$3,550'),
  (246, 'Lattafa Mayar Natural Intense', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (247, 'Lattafa Musamam White Intense', 'RD$3,350', 'RD$3,650', 'RD$4,250'),
  (248, 'Lattafa Musamam', 'RD$3,250', null, 'RD$3,550'),
  (251, 'Lattafa Pride Art Of Nature II', 'RD$3,350', 'RD$3,650', 'RD$4,250'),
  (252, 'Lattafa Pride Peace Love', 'RD$3,400', null, 'RD$3,850'),
  (253, 'Lattafa Pride Al Qiam Silver', 'RD$3,050', null, 'RD$3,550'),
  (254, 'Lattafa Pride Ansaam Silver', 'RD$3,050', null, 'RD$3,550'),
  (255, 'Lattafa Pride Art Of Arabia II', 'RD$3,400', null, 'RD$3,850'),
  (256, 'Lattafa The Kingdom Men', 'RD$2,850', 'RD$3,050', 'RD$3,550'),
  (257, 'Lattafa Pride Art Of Universe', 'RD$3,550', 'RD$3,850', 'RD$4,450'),
  (258, 'Lattafa Pride Brioche Vanille', 'RD$3,250', null, 'RD$3,750'),
  (259, 'Lattafa The Kingdom Women', 'RD$2,850', 'RD$3,050', 'RD$3,550'),
  (260, 'Lattafa Pride Nebras', 'RD$3,000', 'RD$3,250', 'RD$3,750'),
  (261, 'Lattafa Pride Shaheen Gold', 'RD$3,050', null, 'RD$3,550'),
  (262, 'Lattafa Pride Vintage Radio', 'RD$2,850', 'RD$3,050', 'RD$3,550'),
  (263, 'Lattafa Qaed Al Fursan', 'RD$2,450', 'RD$2,550', 'RD$2,950'),
  (264, 'Lattafa Qaed Al Fursan Unlimited', 'RD$2,550', 'RD$2,750', 'RD$3,150'),
  (269, 'Lattafa Rave Now Black', 'RD$2,550', 'RD$2,650', 'RD$3,050'),
  (270, 'Lattafa Rave Now', 'RD$2,550', 'RD$2,650', 'RD$3,050'),
  (271, 'Zimaya Fatima Pink', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (273, 'Lattafa Taureau De Combat', 'RD$3,550', null, 'RD$4,050'),
  (274, 'Lattafa Teriaq', 'RD$3,250', null, 'RD$3,750'),
  (275, 'Lattafa Teriaq Intense', 'RD$3,550', null, 'RD$4,050'),
  (276, 'Lattafa Tharwah Gold', 'RD$3,050', null, 'RD$3,550'),
  (277, 'Maison Alhambra Jean Lowe Inmortal', 'RD$2,750', 'RD$3,050', 'RD$3,550'),
  (278, 'Maison Alhambra Winsome', 'RD$2,750', null, 'RD$3,150'),
  (279, 'Maison Alhambra Jean Lowe Maitre', 'RD$2,750', null, 'RD$3,150'),
  (280, 'Maison Alhambra La Voie', 'RD$2,550', 'RD$2,750', 'RD$3,150'),
  (281, 'Maison Alhambra Salvo', 'RD$2,550', 'RD$2,750', 'RD$3,150'),
  (282, 'Mont Blanc Legend EDP', 'RD$5,150', null, 'RD$5,850'),
  (283, 'Mancera Instant Crush', 'RD$6,650', null, 'RD$6,950'),
  (284, 'Mont Blanc Explorer Platinum', 'RD$3,750', 'RD$4,350', 'RD$4,950'),
  (285, 'Mont Blanc Emblem Men', 'RD$5,250', null, 'RD$6,050'),
  (286, 'Mont Blanc Explorer EDP', 'RD$5,050', null, 'RD$5,350'),
  (288, 'Givenchy Pi Men', 'RD$4,350', 'RD$4,550', 'RD$5,250'),
  (289, 'Mont Blanc Legend Spirit', 'RD$4,350', null, 'RD$4,950'),
  (290, 'Mont Blanc Signature Absolue', 'RD$4,350', null, 'RD$4,950'),
  (292, 'Moschino Toy 2', 'RD$4,450', 'RD$4,550', 'RD$5,250'),
  (293, 'Moschino Toy 2 Bubble Gum', 'RD$4,450', 'RD$4,550', 'RD$5,250'),
  (294, 'Moschino Toy 2 Pearl', 'RD$4,950', null, 'RD$5,650'),
  (295, 'Moschino Toy Boy', 'RD$4,450', 'RD$4,550', 'RD$5,250'),
  (296, 'Nautica Blue', 'RD$2,550', null, 'RD$2,850'),
  (297, 'Nautica Classic', 'RD$2,550', null, 'RD$2,850'),
  (298, 'Nautica Voyage', 'RD$2,250', 'RD$2,350', 'RD$2,650'),
  (299, 'Nitro Red Intensely', 'RD$3,650', 'RD$4,150', 'RD$4,750'),
  (300, 'Mont Blanc Legend EDP', 'RD$5,350', null, 'RD$6,050'),
  (301, 'Orientica Oud Saffron', 'RD$5,650', null, 'RD$6,350'),
  (302, 'Orientica Royal Bleu', 'RD$5,650', null, 'RD$6,350'),
  (303, 'Orientica Velvet Gold', 'RD$5,650', null, 'RD$6,350'),
  (304, 'Paco Invictus Victory EDP', 'RD$8,450', null, 'RD$9,450'),
  (305, 'Paco Invictus Victory Elixir Men Intense', 'RD$7,850', null, 'RD$8,950'),
  (306, 'Paco Olympea Women', 'RD$7,350', null, 'RD$8,250'),
  (308, 'Paco One Million EDT Men', 'RD$5,850', null, 'RD$6,350'),
  (310, 'Paris Corner Marshmallow Blush', 'RD$3,000', null, 'RD$3,550'),
  (311, 'Rasasi Hawas London', 'RD$4,550', null, 'RD$5,250'),
  (314, 'Prada Luna Rossa EDT', 'RD$6,450', null, 'RD$6,950'),
  (316, 'Prada Paradoxe', 'RD$9,350', null, 'RD$10,550'),
  (317, 'Rasasi Hawas Ice', 'RD$3,850', 'RD$4,050', 'RD$4,450'),
  (318, 'Rasasi Hawas For Him', 'RD$2,950', null, 'RD$3,350'),
  (319, 'Rasasi Hawas Atlantis', 'RD$3,750', null, 'RD$4,050'),
  (321, 'Rasasi Hawas Malibu', 'RD$3,750', 'RD$3,950', 'RD$4,450'),
  (322, 'Rasasi Hawas Eclat', 'RD$3,950', null, 'RD$4,450'),
  (323, 'Rasasi Hawas Elixir Men', 'RD$3,950', null, 'RD$4,450'),
  (324, 'Rasasi Hawas Fire Men', 'RD$3,950', null, 'RD$4,450'),
  (326, 'Rasasi Hawas Tropical', 'RD$3,950', 'RD$4,150', 'RD$4,750'),
  (327, 'Rayhaan Elixir', 'RD$3,050', null, 'RD$3,550'),
  (328, 'Rayhaan Imperia', 'RD$2,750', null, 'RD$3,150'),
  (329, 'Versce Red Jeans Women', 'RD$3,250', null, 'RD$3,750'),
  (332, 'Afnan 9AM Dive Set 3PC', 'RD$3,950', null, 'RD$4,450'),
  (333, 'Set Yara And Candy', 'RD$3,950', null, 'RD$4,450'),
  (334, 'Set - Afnan 9PM 3PCS', 'RD$4,150', null, 'RD$4,750'),
  (336, 'Set Armaf Club De Nuit Intense 4 Piece Gift', 'RD$4,450', null, 'RD$5,150'),
  (337, 'Set Club De Nuit For Women 4PCS', 'RD$4,450', null, 'RD$5,150'),
  (338, 'Set - Armaf Odyssey Limoni 4PCS', 'RD$4,350', null, 'RD$4,950'),
  (339, 'Set Odyssey Mandarin Sky 4PCS', 'RD$4,450', null, 'RD$5,150'),
  (340, 'Set - Yves Saint Laurent 2PCS', 'RD$6,750', null, 'RD$6,950'),
  (345, 'Set - Game Of Spades Full House', 'RD$5,400', null, 'RD$6,150'),
  (346, 'Set - Azzaro Wanted Eau De Parfum', 'RD$6,750', null, 'RD$6,950'),
  (347, 'Yara Gift Set', 'RD$3,950', null, 'RD$4,450'),
  (351, 'Set - Collection Esmeralda & Wilcard', 'RD$8,750', null, 'RD$9,850'),
  (353, 'Set - Yara Rosado 3PCS', 'RD$3,950', null, 'RD$4,450'),
  (356, 'Set - Joop Homme 2PCS', 'RD$3,050', null, 'RD$3,550'),
  (357, 'Set - Lattafa Angham 3PCS', 'RD$4,350', null, 'RD$4,950'),
  (359, 'Set - Lattafa Yara Collection 25ML 4PCS', 'RD$3,950', null, 'RD$4,450'),
  (360, 'Set - Lattafa Asad Men Black 3PCS', 'RD$3,450', null, 'RD$3,550'),
  (361, 'Set - Lattafa Badee Al Oud Noble Blush 3PCS', 'RD$3,950', null, 'RD$4,450'),
  (363, 'Set - Lattafa Badee Sublime 3PCS', 'RD$3,950', null, 'RD$4,450'),
  (366, 'Set - Eclaire 2PCS', 'RD$3,950', null, 'RD$4,450'),
  (368, 'Set - Lattafa Pride Art Of Universe 3PCS', 'RD$4,550', null, 'RD$5,150'),
  (369, 'Set De Asad Bourbon', 'RD$3,750', null, 'RD$3,850'),
  (370, 'Set - Moschino Toy Boy 3PCS', 'RD$5,950', null, 'RD$6,750'),
  (371, 'Set - Lattafa Yara Collection 25ML 4PCS', 'RD$3,900', null, 'RD$4,450'),
  (375, 'Spicebomb EDT Men', 'RD$6,150', null, 'RD$6,950'),
  (376, 'Emper Stallion 53', 'RD$2,850', null, 'RD$3,250'),
  (377, 'Emper Elixir 88', 'RD$2,950', null, 'RD$3,350'),
  (378, 'Emper Intenso', 'RD$2,850', null, 'RD$3,250'),
  (379, 'Stallion 53 Captcha 36', 'RD$2,850', null, 'RD$3,250'),
  (381, 'Emper Stallion 9 To 9 Gold', 'RD$3,050', null, 'RD$3,550'),
  (382, 'Emper Stallion Uomo Intense', 'RD$3,250', null, 'RD$3,750'),
  (384, 'Valentino Boirn In Roma Intense', 'RD$10,350', null, 'RD$11,450'),
  (385, 'Valentino Born In Roma Coral Fantasy', 'RD$8,950', 'RD$9,150', 'RD$10,250'),
  (386, 'Valentino Born In Roma Coral Fantasy', 'RD$9,250', null, 'RD$10,450'),
  (387, 'Valentino Born In Roma Green Stravaganza', 'RD$8,450', null, 'RD$9,550'),
  (388, 'Valentino Born In Roma Intense Women', 'RD$10,450', 'RD$10,350', 'RD$11,450'),
  (389, 'Valentino Donna Born In Roma Women', 'RD$9,250', null, 'RD$10,450'),
  (390, 'Valentino Donna Women EDP', 'RD$7,750', null, 'RD$8,750'),
  (391, 'Valentino Uomo Born In Roma Extradose', 'RD$10,350', null, 'RD$11,450'),
  (393, 'Versace Dreamer EDT', 'RD$3,950', null, 'RD$4,450'),
  (394, 'Versace Dylan Blue EDT', 'RD$5,150', 'RD$6,150', 'RD$6,550'),
  (395, 'Versace Eros EDT Men', 'RD$4,650', 'RD$5,250', 'RD$5,550'),
  (396, 'Versace Eros Eu De Parfum Men', 'RD$5,950', 'RD$6,150', 'RD$6,950'),
  (397, 'Versace Eros Parfum Men', 'RD$6,150', 'RD$6,450', 'RD$6,950'),
  (399, 'Versace Eros Flame EDP Men', 'RD$6,450', null, 'RD$6,950'),
  (400, 'Versace Eros Najim', 'RD$9,650', null, 'RD$10,850'),
  (401, 'Xerjoff Erba Pura EDP Unisex', 'RD$15,250', null, 'RD$16,850'),
  (402, 'Blue Chanel', 'RD$15,150', null, 'RD$15,450'),
  (404, 'Yara Candy EDP Women', 'RD$2,950', null, 'RD$3,350'),
  (405, 'Yara Elixir EDP', 'RD$3,550', 'RD$3,950', 'RD$4,450'),
  (406, 'Yara Moi', 'RD$2,550', null, 'RD$2,850'),
  (407, 'Yara Rosado', 'RD$2,550', null, 'RD$2,850'),
  (408, 'Yara Tous', 'RD$2,750', null, 'RD$3,050'),
  (409, 'YSL Libre Eau Le Parfum Women', 'RD$8,350', null, 'RD$9,450'),
  (410, 'YSL Libre Le Parfum Women', 'RD$8,050', null, 'RD$9,050'),
  (411, 'YSL Y EDT Men', 'RD$8,350', null, 'RD$9,450'),
  (412, 'Yves Saint Laurent EDP Men', 'RD$9,650', null, 'RD$10,850'),
  (418, 'Zakat Z9', 'RD$3,050', null, 'RD$3,550'),
  (419, 'Set - Game Of Spades Wildcard', 'RD$5,400', null, 'RD$6,150'),
  (420, '9PM Out Night', 'RD$4,150', 'RD$4,350', 'RD$4,950'),
  (421, 'Afnan Supremacy Collector''s Edition Pour Homme', 'RD$4,150', null, 'RD$4,750'),
  (422, 'Armaf Club de Nuit Elite', 'RD$4,450', null, 'RD$5,150'),
  (423, 'Armaf Dunescape Dubai', 'RD$3,950', null, 'RD$4,450'),
  (424, 'Armaf Eter Arabian Sky', 'RD$4,150', null, 'RD$4,750'),
  (425, 'Bharara Mast Rome Pink pour Vanille', 'RD$3,350', null, 'RD$3,850'),
  (426, 'Dumont Nitro Elixir Men', 'RD$3,950', 'RD$4,150', 'RD$4,750'),
  (427, 'Dumont Nitro Gold', 'RD$3,950', 'RD$4,150', 'RD$4,750'),
  (428, 'Stallion 53 Green Sublime', 'RD$3,250', null, 'RD$3,750'),
  (429, 'Stallion 53 Imperial', 'RD$3,250', null, 'RD$3,750'),
  (430, 'Stallion 53 Ivory Dream', 'RD$3,250', null, 'RD$3,750'),
  (431, 'Stallion 53 La Furia', 'RD$3,250', null, 'RD$3,750'),
  (432, 'Stallion 53 Paradise', 'RD$3,250', null, 'RD$3,750'),
  (433, 'French Avenue Liquid Brun Limited Edition', 'RD$4,850', null, 'RD$5,550'),
  (434, 'French Avenue Veneno Scarlet', 'RD$4,150', null, 'RD$4,750'),
  (435, 'French Avenue Vulcan Feu', 'RD$4,350', null, 'RD$4,950'),
  (436, 'Lattafa Al Noble Ameer', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (437, 'Lattafa Al Noble Safeer', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (438, 'Lattafa Al Noble Wazeer', 'RD$2,850', 'RD$2,950', 'RD$3,350'),
  (439, 'Lattafa Ana Abiyedh Passion', 'RD$3,050', null, 'RD$3,550'),
  (440, 'Lattafa Bade''e Al Oud Black Exposed', 'RD$4,350', null, 'RD$4,950'),
  (441, 'Lattafa Jasoor', 'RD$3,050', null, 'RD$3,550'),
  (442, 'Lattafa Jouri', 'RD$3,850', null, 'RD$4,450'),
  (443, 'Lattafa Khamrah Waha', 'RD$3,050', null, 'RD$4,750'),
  (444, 'Lattafa Petra Viola', 'RD$4,150', null, 'RD$4,750'),
  (445, 'Lattafa Pride Amethyst', 'RD$4,350', null, 'RD$4,950'),
  (446, 'Lattafa Pride London The City of Contrast', 'RD$3,750', null, 'RD$4,250'),
  (447, 'Lattafa Pride Love in Paris', 'RD$3,750', null, 'RD$4,250'),
  (448, 'Lattafa Pride New York The City of Dreams', 'RD$3,750', null, 'RD$4,250'),
  (449, 'Orientica Royal Amber', 'RD$5,350', null, 'RD$6,050'),
  (450, 'Rasasi Hawas Sapphire', 'RD$3,950', null, 'RD$4,450'),
  (451, 'Rasasi Hawas Kobra for Him', 'RD$4,150', null, 'RD$4,750'),
  (452, 'Rasasi Hawas Nautilus', 'RD$4,350', null, 'RD$4,950'),
  (453, 'Rasasi Hawas Verde', 'RD$4,150', null, 'RD$4,750'),
  (454, 'Rayhaan Azul', 'RD$3,550', null, 'RD$4,050'),
  (455, 'Rayhaan Pacific Aloha', 'RD$3,550', null, 'RD$4,050'),
  (456, 'Rayhaan Tropical Vibe', 'RD$3,950', null, 'RD$4,450'),
  (457, 'Riiffs Freeze', 'RD$3,550', null, 'RD$4,050'),
  (458, 'Riiffs Freeze in Flames Extrait', 'RD$4,150', null, 'RD$4,750'),
  (459, 'Bharara Mast Rome Ivory pour Femme', 'RD$3,050', 'RD$3,350', 'RD$3,850'),
  (460, 'Bharara Mast Rome Lucky', 'RD$3,550', 'RD$3,350', 'RD$3,850'),
  (461, 'Zakat Z6', 'RD$3,050', null, 'RD$3,550'),
  (462, 'Calvin Klein CK One Shock EDT Men', 'RD$3,250', null, 'RD$3,750'),
  (464, '212 NYC EDT Men', 'RD$5,950', null, 'RD$6,750'),
  (465, 'Carolina Herrera Bad Boy Extreme Men', 'RD$7,150', null, 'RD$8,050'),
  (466, 'Carolina Herrera Bad Boy Le Parfum Men', 'RD$6,850', null, 'RD$6,950'),
  (467, 'Carolina Herrera Good Girl Blush Elixir Women', 'RD$10,250', null, 'RD$11,450'),
  (468, 'Coach Green EDT Men', 'RD$8,450', null, 'RD$9,550'),
  (469, 'JPG Divine Elixir Women', 'RD$9,250', null, 'RD$10,450'),
  (470, 'JPG Le Male Pride Edition EDT Men', 'RD$8,050', null, 'RD$9,050'),
  (471, 'Lolita Lempicka Homme EDT', 'RD$3,950', null, 'RD$4,450'),
  (472, '360 For Men EDT', 'RD$3,350', null, 'RD$3,850'),
  (473, 'Valentino Uomo Born In Roma EDT', 'RD$8,050', null, 'RD$8,450'),
  (474, 'Versace Man Eau Fraiche EDT', 'RD$5,150', null, 'RD$5,850'),
  (475, 'Giardini di Toscana Bianco Latte', 'RD$11,650', null, 'RD$13,050'),
  (476, 'Lorenzo Pazzaglia Summer Hammer', 'RD$10,950', null, 'RD$12,250'),
  (477, 'Lorenzo Pazzaglia Sun-Gria', 'RD$11,050', null, 'RD$12,450'),
  (478, 'Mancera French Riviera', 'RD$8,950', null, 'RD$10,150'),
  (479, 'Parfums de Marly Delina Women', 'RD$16,850', null, 'RD$18,550'),
  (480, 'Parfums de Marly Layton', 'RD$17,250', null, 'RD$19,050'),
  (481, 'Xerjoff Torino21', 'RD$14,250', null, 'RD$15,750'),
  (482, 'Set Armaf Club de Nuit Untold 4PCS', 'RD$5,150', null, 'RD$5,850'),
  (483, 'Set Armaf Odyssey Aqua 4PCS', 'RD$4,450', null, 'RD$5,150'),
  (484, 'Set Dolce & Gabbana Light Blue Women 2PCS', 'RD$6,250', null, 'RD$6,950'),
  (485, 'Set Stallion 53 4 In 1', 'RD$3,550', null, 'RD$4,050'),
  (486, 'Set Game of Spades Collection II 3PCS', 'RD$6,150', null, 'RD$6,950'),
  (487, 'Set Game of Spades Opal 4PCS', 'RD$5,350', null, 'RD$6,150'),
  (488, 'Set Game of Spades Parfum 9 Minis', 'RD$4,950', null, 'RD$5,650'),
  (489, 'Set Game of Spades Rouge 4PCS', 'RD$5,350', null, 'RD$6,150'),
  (490, 'Set Lattafa Asad Collection 4PCS', 'RD$4,150', null, 'RD$4,750'),
  (491, 'Set Lattafa Haya 3PCS', 'RD$4,350', null, 'RD$4,950'),
  (492, 'Set Lattafa Musamam White Intense 3PCS', 'RD$4,450', null, 'RD$5,150'),
  (493, 'Set Rasasi Hawas Fire 3PCS', 'RD$5,250', null, 'RD$6,050'),
  (494, 'Set Rasasi Hawas Ice Travel 2PCS', 'RD$4,450', null, 'RD$5,150'),
  (495, 'Set Versace Eros 3PCS', 'RD$5,850', null, 'RD$6,650'),
  (496, 'Set Versace Eros Flame 3PCS', 'RD$5,950', 'RD$6,450', 'RD$6,950'),
  (497, 'Armani Power of You EDP Women', 'RD$9,350', null, 'RD$10,450'),
  (498, 'Armani Stronger With You Spices EDP', 'RD$10,050', null, 'RD$11,250'),
  (499, 'Azzaro Wanted Girl EDP', 'RD$6,050', null, 'RD$6,850'),
  (500, 'Dolce & Gabbana Devotion EDP Intense', 'RD$6,450', null, 'RD$6,950'),
  (501, 'Dolce & Gabbana Light Blue Capri in Love', 'RD$5,750', null, 'RD$6,550'),
  (502, 'Hugo Boss Dark Blue EDT', 'RD$3,950', null, 'RD$4,450'),
  (503, 'JPG Divine Collector Edition', 'RD$8,350', null, 'RD$9,350'),
  (504, 'JPG La Belle Rosea EDP', 'RD$10,050', null, 'RD$11,250'),
  (505, 'JPG Scandal Intense EDP Women', 'RD$7,950', null, 'RD$9,050'),
  (507, 'Jimmy Choo I Want Choo Forever EDP', 'RD$6,550', null, 'RD$6,950'),
  (508, 'Moschino Toy 2 Gummy', 'RD$6,550', null, 'RD$6,950'),
  (509, 'Moschino Toy 2 Yummy', 'RD$6,150', null, 'RD$6,950'),
  (510, 'Rabanne Fame The Couture Edition EDP', 'RD$7,750', null, 'RD$8,750'),
  (511, 'Rabanne 1 Million Black EDP Men', 'RD$7,750', 'RD$9,350', 'RD$10,550'),
  (512, 'Paco Lady Million EDP Women', 'RD$6,650', null, 'RD$6,950'),
  (513, 'Paco One Million Lucky EDT Men', 'RD$7,450', 'RD$7,750', 'RD$8,750'),
  (514, 'Valentino Donna Vendetta EDP Women', 'RD$12,050', null, 'RD$13,250'),
  (515, 'Valentino Uomo Born In Roma Yellow Dream EDT', 'RD$8,450', null, 'RD$9,550'),
  (516, 'YSL MYSLF Le Parfum Men', 'RD$9,750', null, 'RD$10,850'),
  (517, 'Armaf Club de Nuit Intenso Fuego', 'RD$5,050', null, 'RD$5,650'),
  (518, 'Armaf Club de Nuit Maleka', 'RD$4,150', null, 'RD$4,750'),
  (519, 'Armaf Club de Nuit Oud', 'RD$3,250', 'RD$3,650', 'RD$4,250'),
  (520, 'French Avenue Vulcan Baie', 'RD$4,350', null, 'RD$4,950'),
  (521, 'Game of Spades Bluff', 'RD$4,950', null, 'RD$5,650'),
  (522, 'Game of Spades Full-House Refresh', 'RD$5,350', null, 'RD$6,050'),
  (523, 'Game of Spades Trick', 'RD$4,950', null, 'RD$5,650'),
  (524, 'Lattafa Fakhar Platin', 'RD$2,750', null, 'RD$3,150'),
  (525, 'Acqua di Parma Fico di Amalfi EDT', 'RD$11,150', null, 'RD$12,550'),
  (526, 'Acqua di Parma Fico di Amalfi La Riserva EDP', 'RD$11,550', null, 'RD$12,950'),
  (527, 'Creed Aventus Cologne', 'RD$28,450', null, 'RD$31,450'),
  (528, 'Creed Original Santal', 'RD$24,650', null, 'RD$27,250'),
  (529, 'Elivi Exotic Extrait de Parfum', 'RD$11,750', null, 'RD$13,150'),
  (530, 'Elivi Mor Extrait de Parfum', 'RD$12,550', null, 'RD$13,950'),
  (531, 'Elivi Unstoppable Hong Kong', 'RD$11,250', null, 'RD$12,650'),
  (532, 'Parfums de Marly Perseus', 'RD$15,850', null, 'RD$17,450'),
  (533, 'Tom Ford Eau de Soleil Blanc EDT', 'RD$11,650', null, 'RD$13,050'),
  (534, 'Tom Ford F***ing Fabulous EDP', 'RD$29,850', null, 'RD$32,950'),
  (535, 'Set Afnan 9 AM Pour Femme', 'RD$3,950', null, 'RD$4,450'),
  (536, 'Set Calvin Klein CK One 3PCS', 'RD$4,850', null, 'RD$5,450'),
  (537, 'Set Jean Paul Gaultier Miniatures 4PCS', 'RD$5,750', null, 'RD$6,550'),
  (538, 'Set Lattafa Pride Vintage Radio', 'RD$3,050', null, 'RD$3,550');

-- Copia de cómo estaban (solo la primera vez y solo los que se van a cambiar), para poder deshacer.
create table if not exists private.precios_antes_margen_20261110 (
  id bigint primary key, price text not null, original_price text, offer_label text, offer_ends_at timestamptz,
  availability text not null, guardado timestamptz not null default now()
);
revoke all on private.precios_antes_margen_20261110 from public, anon, authenticated;
insert into private.precios_antes_margen_20261110 (id, price, original_price, offer_label, offer_ends_at, availability)
select p.id, p.price, p.original_price, p.offer_label, p.offer_ends_at, p.availability
  from public.products p join cambios c using (id), modo m
 where not m.deshacer and lower(p.name) = lower(c.nombre) and p.price in (c.antes, coalesce(c.antes_nov, c.antes)) and p.original_price is null
on conflict (id) do nothing;

with hechos as (
  update public.products p
     set price = c.ahora, updated_at = now()
    from cambios c, modo m
   where not m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre)
     and p.price in (c.antes, coalesce(c.antes_nov, c.antes)) and p.original_price is null
  returning p.id
)
insert into resumen
select 1, 'Precios cambiados con la fórmula nueva', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where not m.deshacer and p.price = c.ahora and p.original_price is null),
       (select count(*) from cambios, modo m where not m.deshacer);

with hechos as (
  update public.products p
     set price = b.price, original_price = b.original_price, offer_label = b.offer_label,
         offer_ends_at = b.offer_ends_at, availability = b.availability, updated_at = now()
    from cambios c join private.precios_antes_margen_20261110 b using (id), modo m
   where m.deshacer and p.id = c.id and lower(p.name) = lower(c.nombre) and p.price = c.ahora and p.original_price is null
  returning p.id
)
insert into resumen
select 1, 'Precios devueltos a como estaban (deshacer)', (select count(*) from hechos),
       (select count(*) from public.products p join cambios c using (id), modo m
         where m.deshacer and p.price in (c.antes, coalesce(c.antes_nov, c.antes)) and p.original_price is null),
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
                   else 'en tu tienda dice ' || p.price || ' y este archivo esperaba ' || c.antes || coalesce(' o ' || c.antes_nov, '') end,
           null, null, null
      from cambios c left join public.products p using (id), modo m
     where p.id is null or lower(p.name) <> lower(c.nombre) or p.original_price is not null
        or case when m.deshacer then p.price not in (c.antes, coalesce(c.antes_nov, c.antes)) and not (p.price = c.ahora and exists (select 1 from private.precios_antes_margen_20261110 b where b.id = c.id))
                else p.price not in (c.antes, coalesce(c.antes_nov, c.antes), c.ahora) end
  ) r
 order by orden, cambio;

-- La primera vez verás «hechos_ahora» con los precios. Si lo repites: todo en «ya_estaban».
-- FIN
