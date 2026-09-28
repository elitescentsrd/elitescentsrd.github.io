-- DISPONIBILIDAD Y PRECIOS — 28 de septiembre de 2026 (catálogo de La Grada de septiembre)
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. PRECIOS a nivel de la competencia: baja 10 y sube 2 (precio normal, sin ofertas).
--   2. DISPONIBLE: los 342 perfumes del catálogo de La Grada quedan «Disponible»,
--      menos los de RD$7,000 o más, que siguen «Solo por encargo» como siempre.
--   3. AGOTADO: los 78 que no están en el catálogo vuelven a verse en la web, marcados «Agotado».
--   4. Regla automática de RD$7,000 o más: ahora respeta «Agotado» (antes lo pasaba a «Solo por encargo»).
--   Las ofertas vigentes y los demás precios no se tocan.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este archivo → Run.
-- Comprueba que pegaste todo: la primera línea empieza con «-- DISPONIBILIDAD Y PRECIOS» y la última
-- dice «-- FIN». Al final verás una tabla con lo que se cambió.
--
-- Es seguro repetirlo: un precio solo cambia si sigue igual al de hoy (si lo cambiaste a mano en el
-- panel, se respeta y aparece en «sin_cambiar»). La primera vez guarda una copia de la disponibilidad
-- de todos los perfumes (tabla private.respaldo_2026_09_28) para poder deshacer.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo.
-- Devuelve los precios, la disponibilidad y la visibilidad que había antes de este script.

-- 4. «Solo por encargo» automático desde RD$7,000, salvo que el perfume esté «Agotado».
create or replace function private.enforce_high_price_by_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  highest_price numeric;
begin
  select max(replace(replace(price_match[1], ',', ''), '.', '')::numeric)
    into highest_price
  from regexp_matches(new.price, '([0-9][0-9,.]*)', 'g') as price_match;

  if highest_price >= 7000 and new.availability is distinct from 'agotado' then
    new.availability := 'encargo';
  end if;

  return new;
end;
$$;

-- Copia de seguridad para deshacer (solo se crea la primera vez).
create table if not exists private.respaldo_2026_09_28 as
  select id, price, availability, active, now() as guardado_en from public.products;

create temp table modo on commit drop as select false as deshacer;  -- ← DESHACER: cambia false por true
create temp table resumen (orden int, cambio text, hechos_ahora bigint, ya_estaban bigint, total bigint) on commit drop;

-- 1. Precios (el más grande de cada perfume; en los de dos tamaños el otro se queda igual).
create temp table precios (id bigint primary key, antes text not null, nuevo text not null) on commit drop;
insert into precios (id, antes, nuevo) values
  (2, 'RD$6,650', 'RD$6,150'),  -- 212 VIP EDT NY Men (baja)
  (15, 'RD$6,250', 'RD$5,750'),  -- Acqua di Giò EDT Men (baja)
  (62, 'RD$3,300', 'RD$3,050'),  -- Armaf Odyssey Mandarin Elixir (baja)
  (71, 'RD$2,850 / RD$3,600', 'RD$2,850 / RD$3,250'),  -- Armaf Odyssey Homme White (baja)
  (83, 'RD$5,450', 'RD$4,950'),  -- Armani Stronger With You EDT (baja)
  (116, 'RD$3,150', 'RD$2,950'),  -- Calvin Klein One (baja)
  (135, 'RD$5,650', 'RD$4,950'),  -- Dolce & Gabbana The One (baja)
  (156, 'RD$3,350', 'RD$3,050'),  -- French Avenue Liquid Brun (baja)
  (195, 'RD$4,550', 'RD$4,950'),  -- Issey Miyake Pour Homme (sube)
  (208, 'RD$8,250', 'RD$7,450'),  -- JPG Ultra Male 4.2 Intense (baja)
  (215, 'RD$8,450', 'RD$7,850'),  -- Lancome La Vie Est Belle (baja)
  (394, 'RD$4,750', 'RD$5,150');  -- Versace Dylan Blue EDT (sube)

-- 2. Perfumes del catálogo de La Grada.
create temp table catalogo (id bigint primary key) on commit drop;
insert into catalogo (id) values
  (1),  -- 212 Sexy EDT Men
  (2),  -- 212 VIP EDT NY Men
  (3),  -- 212 VIP NYC EDP Women
  (4),  -- 212 VIP Black EDP Men
  (5),  -- 212 VIP Rosé EDP Women
  (6),  -- 360 Collection For Men EDT
  (7),  -- 360 Red EDP Women
  (8),  -- 360 Red EDP Men
  (9),  -- 360 White EDT Women
  (10),  -- 9 AM Dive Blue EDP Men Afnan
  (11),  -- 9 PM EDP Men Afnan
  (12),  -- 9 PM Elixir Men Afnan
  (13),  -- 9 PM Rebel Men Afnan
  (15),  -- Acqua di Giò EDT Men
  (16),  -- Acqua di Giò Profondo EDP Men
  (17),  -- Afeef EDP Unisex
  (18),  -- Afnan Rare Carbon
  (20),  -- Lattafa Tharwah Silver
  (22),  -- Afnan Zimaya Tiramisu Coco
  (23),  -- Lattafa Winners Trophy Silver
  (25),  -- Jean Lowe Azure EDP Spray
  (26),  -- Jean Lowe Vibe EDP Spray
  (27),  -- Al Haramain Dubai Night
  (28),  -- Al Haramain Gold Edition
  (29),  -- Al Haramain Ruby
  (30),  -- Al Haramain White
  (31),  -- Al Haramain Aqua Dubai
  (32),  -- Emper Aruba Tonka
  (33),  -- Ana Abiyedh Coral EDP Spray
  (34),  -- Ariana Grande Thank U Next
  (35),  -- Ariana Grande Ari
  (36),  -- Ariana Grande Cloud
  (37),  -- Ariana Grande Cloud Intense 2.0
  (38),  -- Ariana Grande Cloud Pink
  (39),  -- Ariana Grande Moonlight
  (40),  -- Ariana Grande Sweet Like Candy
  (41),  -- Armaf Beach Party
  (43),  -- Armaf Club de Nuit Précieux I
  (46),  -- Armaf Club de Nuit Précieux IV
  (47),  -- Armaf Club de Nuit Women
  (48),  -- Armaf Club de Nuit Blue Iconic
  (49),  -- Armaf Club de Nuit Impériale
  (50),  -- Armaf Club de Nuit Intense Men
  (52),  -- Armaf Club de Nuit Milestone
  (53),  -- Armaf Club de Nuit Sillage
  (54),  -- Armaf Club de Nuit Untold
  (55),  -- Armaf Club de Nuit Urban Elixir
  (57),  -- Armaf Island Bliss Delights
  (58),  -- Armaf Yum Yum
  (59),  -- Armaf Island Bon Bon Delights
  (60),  -- Armaf Island Breeze Delights
  (61),  -- Armaf Miss Attitude
  (62),  -- Armaf Odyssey Mandarin Elixir
  (63),  -- Armaf Odyssey Aoud Edition
  (64),  -- Armaf Odyssey Aqua
  (65),  -- Armaf Odyssey Artisto
  (66),  -- Armaf Odyssey Bahamas
  (67),  -- Armaf Odyssey Black Forest
  (68),  -- Armaf Odyssey Candee Woman
  (70),  -- Armaf Odyssey Homme
  (71),  -- Armaf Odyssey Homme White
  (72),  -- Armaf Odyssey Limoni
  (73),  -- Armaf Odyssey Mandarin Sky
  (74),  -- Armaf Odyssey Mega
  (75),  -- Armaf Odyssey Montagne
  (76),  -- Armaf Odyssey Revolution
  (77),  -- Armaf Odyssey Spectra
  (78),  -- Armaf Odyssey Toffee Coffee
  (79),  -- Armaf Odyssey Tyrant
  (80),  -- Armaf Odyssey Wild One
  (81),  -- Armani Code
  (82),  -- Armani Stronger With You EDP
  (83),  -- Armani Stronger With You EDT
  (86),  -- Lattafa Asad Elixir
  (87),  -- Lattafa Asad
  (88),  -- Lattafa Asad Zanzibar
  (89),  -- Lattafa Atlas
  (90),  -- Azzaro Most Wanted Toilette
  (91),  -- Azzaro Most Wanted EDP
  (92),  -- Azzaro Most Wanted EDT Intense
  (93),  -- Lattafa Bade'e Al Oud Amethyst
  (94),  -- Lattafa Bade'e Al Oud For Glory
  (95),  -- Lattafa Bade'e Al Oud Honor & Glory
  (96),  -- Lattafa Bade'e Al Oud Sublime
  (97),  -- Lattafa Bade'e Al Oud Noble Blush
  (98),  -- Bharara Champagne Black
  (99),  -- Lolita Lempicka Women
  (100),  -- Bharara Chocolate
  (102),  -- Bharara King
  (103),  -- Bharara Rome Paradox
  (105),  -- Bharara Rome Imagine
  (106),  -- Bharara Rome Pour Femme
  (107),  -- Bharara Rome Pour Homme
  (108),  -- Versace Blue Jeans Men
  (112),  -- Britney Spears Fantasy EDP
  (113),  -- Calvin Klein Eternity Men
  (114),  -- Calvin Klein Eternity Women
  (115),  -- Calvin Klein Obsession
  (116),  -- Calvin Klein One
  (117),  -- Carolina Herrera Bad Boy Cobalt Men
  (118),  -- Carolina Herrera La Bomba
  (119),  -- Coach New York Wild Rose
  (120),  -- Lattafa Confidential Platinum
  (121),  -- Lattafa Confidential Private Gold
  (122),  -- Diesel Plus Plus Man
  (123),  -- Diesel Plus Plus Women
  (128),  -- Dior Sauvage EDP
  (129),  -- Dior Sauvage Men Antiguo EDT
  (130),  -- Dior Sauvage EDT Men
  (131),  -- Dior Sauvage Elixir
  (132),  -- Dolce & Gabbana Devotion
  (133),  -- Dolce & Gabbana Light Blue Men
  (134),  -- Dolce & Gabbana Light Blue Women
  (135),  -- Dolce & Gabbana The One
  (136),  -- Dolce & Gabbana The One Gold Intense
  (138),  -- Donna Intense Stallion
  (139),  -- Dumont Nitro Blue
  (140),  -- Dumont Nitro Platinum
  (141),  -- Dumont Nitro Intense
  (142),  -- Dumont Nitro Red
  (143),  -- Dumont Nitro White Men
  (144),  -- Lattafa Eclaire
  (146),  -- Lattafa Emeer
  (147),  -- Britney Spears Fantasy Circus Women
  (148),  -- Lomani Paris Millionaire Spirit
  (152),  -- French Avenue Aether Extrait
  (153),  -- French Avenue Atlantis Extrait
  (154),  -- Barakkat Rouge 540 Red
  (155),  -- Barakkat Rouge 540 Extrait EDP
  (156),  -- French Avenue Liquid Brun
  (157),  -- Game of Spades Bid
  (158),  -- Game of Spades Blind Bid
  (159),  -- Game of Spades Bonus
  (160),  -- Game of Spades Boston
  (161),  -- Game of Spades Diamond
  (162),  -- Game of Spades Double Bonus
  (163),  -- Game of Spades Emerald
  (164),  -- Game of Spades Full House
  (166),  -- Game of Spades High Roller
  (167),  -- Game of Spades King
  (168),  -- Game of Spades Moon
  (169),  -- Game of Spades No Limit
  (171),  -- Game of Spades Queen
  (172),  -- Game of Spades Rouge Extrait
  (173),  -- Game of Spades Rouge Parfum
  (174),  -- Game of Spades Royale
  (176),  -- Game of Spades Topaz
  (177),  -- Game of Spades Wildcard
  (178),  -- Game of Spades Win
  (179),  -- Game of Spades Yellow Sapphire
  (180),  -- Game of Spades All-In
  (181),  -- Guess Seductive Homme Men
  (182),  -- Guess Seductive Homme Men
  (183),  -- Hayaati Black
  (184),  -- Hayaati Florence
  (185),  -- Hayaati Al Maleky
  (186),  -- Her Confession
  (187),  -- His Confession
  (188),  -- Hugo XY Men
  (189),  -- Paco Rabanne Invictus
  (190),  -- Paco Rabanne Invictus Parfum
  (191),  -- Ishq Al Shuyukh Silver
  (192),  -- Ishq Al Shuyukh Gold
  (193),  -- Issey Miyake Intense
  (194),  -- Issey Miyake L'Eau d'Issey
  (195),  -- Issey Miyake Pour Homme
  (196),  -- Issey Miyake Sport
  (197),  -- JPG Divine EDP Intense
  (198),  -- JPG La Belle Paradise Garden
  (199),  -- JPG Le Beau 2.5 EDT Men
  (200),  -- JPG Le Beau 4.2 EDT Men
  (201),  -- JPG Le Beau Le Parfum 4.2 EDP
  (202),  -- JPG Le Beau Paradise Garden
  (203),  -- JPG Le Male 4.2 EDT Men
  (204),  -- JPG Le Male Elixir 2.5 EDP Men
  (205),  -- JPG Le Male Elixir 4.2 EDP Men
  (206),  -- JPG Le Male Le Parfum 2.5 EDP Men
  (207),  -- JPG Scandal Le Parfum 3.4 EDP Men
  (208),  -- JPG Ultra Male 4.2 Intense
  (209),  -- JPG Le Beau Flower Edition
  (210),  -- Joop Homme EDT 4.2 EDT Men
  (211),  -- Lattafa Khamrah
  (212),  -- Lattafa Khamrah Dukhan
  (213),  -- Lattafa Khamrah Qahw
  (214),  -- Lacoste L.12.12 Blanc, Pure White
  (215),  -- Lancome La Vie Est Belle
  (216),  -- Lancome La Vie Est Belle L'Elixir
  (219),  -- Lattafa Angham
  (220),  -- Maison Alhambra Delilah
  (221),  -- Lattafa Asad Bourbon
  (222),  -- Coach New York Blue
  (227),  -- Lattafa Eclaire Banoffi
  (228),  -- Lattafa Eclaire Pistache
  (229),  -- Lattafa Fakhar Men
  (230),  -- Lattafa Fakhar Women
  (231),  -- Lattafa Fakhar Gold Extrait
  (232),  -- Lattafa Give Me Gourman Whipped Pleasure
  (233),  -- Lattafa Give Me Gourmand Choco Overdose
  (234),  -- Lattafa Give Me Gourman Cookie Crave
  (236),  -- Lattafa Give Me Gourmand Vanilla Freak
  (237),  -- Lattafa Habik For Men
  (238),  -- Lattafa Haya
  (239),  -- Lattafa Hayaati Gold
  (241),  -- Lattafa La Collection D'Antiquites 1886
  (244),  -- Lattafa Mayar Women
  (245),  -- Lattafa Mayar Cherry Intense
  (246),  -- Lattafa Mayar Natural Intense
  (247),  -- Lattafa Musamam White Intense
  (248),  -- Lattafa Musamam
  (251),  -- Lattafa Pride Art Of Nature II
  (252),  -- Lattafa Pride Peace Love
  (253),  -- Lattafa Pride Al Qiam Silver
  (254),  -- Lattafa Pride Ansaam Silver
  (255),  -- Lattafa Pride Art Of Arabia II
  (256),  -- Lattafa The Kingdom Men
  (257),  -- Lattafa Pride Art Of Universe
  (258),  -- Lattafa Pride Brioche Vanille
  (259),  -- Lattafa The Kingdom Women
  (260),  -- Lattafa Pride Nebras
  (261),  -- Lattafa Pride Shaheen Gold
  (262),  -- Lattafa Pride Vintage Radio
  (263),  -- Lattafa Qaed Al Fursan
  (264),  -- Lattafa Qaed Al Fursan Unlimited
  (269),  -- Lattafa Rave Now Black
  (270),  -- Lattafa Rave Now
  (271),  -- Zimaya Fatima Pink
  (273),  -- Lattafa Taureau De Combat
  (274),  -- Lattafa Teriaq
  (275),  -- Lattafa Teriaq Intense
  (276),  -- Lattafa Tharwah Gold
  (277),  -- Maison Alhambra Jean Lowe Inmortal
  (278),  -- Maison Alhambra Winsome
  (279),  -- Maison Alhambra Jean Lowe Maitre
  (280),  -- Maison Alhambra La Voie
  (281),  -- Maison Alhambra Salvo
  (282),  -- Mont Blanc Legend EDP
  (283),  -- Mancera Instant Crush
  (284),  -- Mont Blanc Explorer Platinum
  (285),  -- Mont Blanc Emblem Men
  (286),  -- Mont Blanc Explorer EDP
  (288),  -- Givenchy Pi Men
  (289),  -- Mont Blanc Legend Spirit
  (290),  -- Mont Blanc Signature Absolue
  (291),  -- Montale Paris Starry Nights
  (292),  -- Moschino Toy 2
  (293),  -- Moschino Toy 2 Bubble Gum
  (294),  -- Moschino Toy 2 Pearl
  (295),  -- Moschino Toy Boy
  (296),  -- Nautica Blue
  (297),  -- Nautica Classic
  (298),  -- Nautica Voyage
  (299),  -- Nitro Red Intensely
  (300),  -- Mont Blanc Legend EDP
  (301),  -- Orientica Oud Saffron
  (302),  -- Orientica Royal Bleu
  (303),  -- Orientica Velvet Gold
  (304),  -- Paco Invictus Victory EDP
  (305),  -- Paco Invictus Victory Elixir Men Intense
  (306),  -- Paco Olympea Women
  (307),  -- Paco One Million EDP Men
  (308),  -- Paco One Million EDT Men
  (309),  -- Paco Rabanne Phantom EDT Men
  (310),  -- Paris Corner Marshmallow Blush
  (311),  -- Rasasi Hawas London
  (314),  -- Prada Luna Rossa EDT
  (315),  -- Prada Luna Rossa Ocean
  (316),  -- Prada Paradoxe
  (317),  -- Rasasi Hawas Ice
  (318),  -- Rasasi Hawas For Him
  (319),  -- Rasasi Hawas Atlantis
  (321),  -- Rasasi Hawas Malibu
  (322),  -- Rasasi Hawas Eclat
  (323),  -- Rasasi Hawas Elixir Men
  (324),  -- Rasasi Hawas Fire Men
  (326),  -- Rasasi Hawas Tropical
  (327),  -- Rayhaan Elixir
  (328),  -- Rayhaan Imperia
  (329),  -- Versce Red Jeans Women
  (332),  -- Afnan 9AM Dive Set 3PC
  (333),  -- Set Yara And Candy
  (334),  -- Set - Afnan 9PM 3PCS
  (336),  -- Set Armaf Club De Nuit Intense 4 Piece Gift
  (337),  -- Set Club De Nuit For Women 4PCS
  (338),  -- Set - Armaf Odyssey Limoni 4PCS
  (339),  -- Set Odyssey Mandarin Sky 4PCS
  (340),  -- Set - Yves Saint Laurent 2PCS
  (345),  -- Set - Game Of Spades Full House
  (346),  -- Set - Azzaro Wanted Eau De Parfum
  (347),  -- Yara Gift Set
  (351),  -- Set - Collection Esmeralda & Wilcard
  (353),  -- Set - Yara Rosado 3PCS
  (355),  -- Set - Game Of Spades Collection 3PCS
  (356),  -- Set - Joop Homme 2PCS
  (357),  -- Set - Lattafa Angham 3PCS
  (359),  -- Set - Lattafa Yara Collection 25ML 4PCS
  (360),  -- Set - Lattafa Asad Men Black 3PCS
  (361),  -- Set - Lattafa Badee Al Oud Noble Blush 3PCS
  (363),  -- Set - Lattafa Badee Sublime 3PCS
  (366),  -- Set - Eclaire 2PCS
  (368),  -- Set - Lattafa Pride Art Of Universe 3PCS
  (369),  -- Set De Asad Bourbon
  (370),  -- Set - Moschino Toy Boy 3PCS
  (373),  -- Spicebomb Dark Leather
  (374),  -- Spicebomb Night Vision
  (375),  -- Spicebomb EDT Men
  (376),  -- Emper Stallion 53
  (377),  -- Emper Elixir 88
  (378),  -- Emper Intenso
  (379),  -- Stallion 53 Captcha 36
  (381),  -- Emper Stallion 9 To 9 Gold
  (382),  -- Emper Stallion Uomo Intense
  (384),  -- Valentino Boirn In Roma Intense
  (385),  -- Valentino Born In Roma Coral Fantasy
  (386),  -- Valentino Born In Roma Coral Fantasy
  (387),  -- Valentino Born In Roma Green Stravaganza
  (388),  -- Valentino Born In Roma Intense Women
  (389),  -- Valentino Donna Born In Roma Women
  (390),  -- Valentino Donna Women EDP
  (391),  -- Valentino Uomo Born In Roma Extradose
  (392),  -- Versace Bright Cryst Women EDP
  (393),  -- Versace Dreamer EDT
  (394),  -- Versace Dylan Blue EDT
  (395),  -- Versace Eros EDT Men
  (396),  -- Versace Eros Eu De Parfum Men
  (397),  -- Versace Eros Parfum Men
  (398),  -- Versace Eros Energy EDP Men
  (399),  -- Versace Eros Flame EDP Men
  (400),  -- Versace Eros Najim
  (401),  -- Xerjoff Erba Pura EDP Unisex
  (402),  -- Blue Chanel
  (404),  -- Yara Candy EDP Women
  (405),  -- Yara Elixir EDP
  (406),  -- Yara Moi
  (407),  -- Yara Rosado
  (408),  -- Yara Tous
  (409),  -- YSL Libre Eau Le Parfum Women
  (410),  -- YSL Libre Le Parfum Women
  (411),  -- YSL Y EDT Men
  (412),  -- Yves Saint Laurent EDP Men
  (418),  -- Zakat Z9
  (419),  -- Set - Game Of Spades Wildcard
  (420);  -- 9PM Out Night

-- 3. Perfumes que no están en el catálogo de La Grada.
create temp table agotados (id bigint primary key) on commit drop;
insert into agotados (id) values
  (14),  -- 9AM White EDP Women Afnan
  (19),  -- Afnan Thurati Electric
  (21),  -- Afnan Zimaya Tiramisu Caramel
  (24),  -- Lattafa Ajwad Pink To Pink
  (42),  -- Armaf Lionheart Woman
  (44),  -- Armaf Checkmate King
  (45),  -- Armaf Checkmate Queen
  (51),  -- Lattafa Musamam Black Intense
  (56),  -- Armaf Connoisseur Women
  (69),  -- Armaf Odyssey Dubai Chocolate
  (84),  -- Armani Stronger With You Absolutely EDP
  (85),  -- Armani Stronger With You Intensely EDP
  (101),  -- Bharara Double Bleu
  (104),  -- Bharara Rome Extradose
  (109),  -- Bond No. 9 Lafayette Street
  (110),  -- Bond No. 9 Tribeca
  (111),  -- Bond No. 9 Greenwich Village
  (124),  -- Dignite Barca
  (125),  -- Dignite Bellina
  (126),  -- Dignite Cute Gal
  (127),  -- Dignite Mystas
  (137),  -- Dolce & Gabbana Light Blue Summer Vibes
  (145),  -- Lattafa Emaan
  (149),  -- Frais et Frais Maitre
  (150),  -- Frais et Frais Amour Frais
  (151),  -- Frais et Frais Nuit Solitaire
  (165),  -- Game of Spades Gold
  (170),  -- Game of Spades Opal
  (175),  -- Game of Spades Ruby
  (217),  -- Lattafa Ameer Al Oud 3.4 EDP Unisex
  (218),  -- Lattafa Ana Abiyedh Poudree 2.0
  (223),  -- Lattafa Decadent Deligh Choco Pista Macaron
  (224),  -- Lattafa Decadent Deligh Passion Fruit Macaron
  (225),  -- Lattafa Decadent Deligh Salted Caramel Macaron
  (226),  -- Lattafa Dynasty
  (235),  -- Lattafa Give Me Gourman Mallow Madness
  (240),  -- Montblanc Legend Red
  (242),  -- Lattafa Maahir Black
  (243),  -- Lattafa Mashrabya
  (249),  -- Lattafa Nebras Elixir
  (250),  -- Lattafa Petra
  (265),  -- Lattafa Qaed Al Fursan Untamed
  (266),  -- Lattafa Qimmah For Men
  (267),  -- Lattafa Ramz Gold
  (268),  -- Lattafa Ramz Silver
  (272),  -- Montblanc Lady Emblem
  (287),  -- Set - Mayar 3PCS Gift
  (312),  -- Polo Green
  (313),  -- Polo Red
  (320),  -- Rasasi Hawas Diva
  (325),  -- Rasasi Hawas Pink
  (330),  -- Rome Ivory Pour Homme
  (331),  -- Maison Alhambra Glacier Le Noir
  (335),  -- Set - Ariana Grande Thank Next
  (341),  -- Set Odyssey Mega Set 4PCS
  (342),  -- Set - Lattafa Pride 5x20ML
  (343),  -- Set Badee Al Oud Honor & Glory 3PCS
  (344),  -- Set - Mast Perfumerome Yum Yum Set 2PCS
  (348),  -- Set Hawas For Him
  (349),  -- Set - Carlina Herrera NY Good Girl Blush 3PCS
  (350),  -- Set - Collection 8 In 1 Game Of Spades
  (352),  -- Set Yara 2PCS
  (354),  -- Set - Yara Moi 3PCS
  (358),  -- Set - Lattafa Ana Abiyedh Rouge 3PCS
  (362),  -- Set - Lattafa Badee Oud For Glory 3PCS
  (364),  -- Set - Lattafa Eclaire 3PCS
  (365),  -- Set - Lattafa Hayaati 2PCS
  (367),  -- Set - Lattafa Now Black 3PCS
  (371),  -- Set - Lattafa Yara Collection 25ML 4PCS
  (372),  -- Set - Odyssey Artisto 4PCS
  (380),  -- Emper Mandora Stallion 53
  (383),  -- Stop Wait Go For EDP Kids
  (403),  -- Mast Perfume Rome Ivory
  (413),  -- Zakat Z 12
  (414),  -- Zakat Z 17
  (415),  -- Zakat Z 25
  (416),  -- Zakat Z 33
  (417);  -- Zakat Z 7

with hechos as (
  update public.products p
     set price = case when m.deshacer then c.antes else c.nuevo end,
         updated_at = now()
    from precios c, modo m
   where p.id = c.id
     and p.original_price is null
     and p.price = case when m.deshacer then c.nuevo else c.antes end
  returning p.id
)
insert into resumen
select 1, 'Precios ajustados a la competencia',
       (select count(*) from hechos),
       (select count(*) from public.products p join precios c using (id), modo m
         where p.original_price is null and p.price = case when m.deshacer then c.antes else c.nuevo end),
       (select count(*) from precios);

with objetivo as (
  select p.id
    from public.products p join catalogo c using (id)
   where (select max(replace(replace(x[1], ',', ''), '.', '')::numeric)
            from regexp_matches(p.price, '([0-9][0-9,.]*)', 'g') as x) < 7000
),
hechos as (
  update public.products p
     set availability = case when m.deshacer then r.availability else 'disponible' end,
         updated_at = now()
    from objetivo o, modo m, private.respaldo_2026_09_28 r
   where p.id = o.id and r.id = p.id
     and case when m.deshacer then p.availability = 'disponible' and r.availability <> 'disponible'
              else p.availability <> 'disponible' end
  returning p.id
)
insert into resumen
select 2, 'Del catálogo: Disponible (menos de RD$7,000)',
       (select count(*) from hechos),
       (select count(*) from public.products p join objetivo o using (id)
          join private.respaldo_2026_09_28 r using (id), modo m
         where p.availability = case when m.deshacer then r.availability else 'disponible' end),
       (select count(*) from objetivo);

insert into resumen
select 3, 'Del catálogo: Solo por encargo (RD$7,000 o más)', 0,
       count(*) filter (where p.availability = 'encargo'), count(*)
  from public.products p join catalogo c using (id)
 where (select max(replace(replace(x[1], ',', ''), '.', '')::numeric)
          from regexp_matches(p.price, '([0-9][0-9,.]*)', 'g') as x) >= 7000;

with hechos as (
  update public.products p
     set active = case when m.deshacer then r.active else true end,
         availability = case when m.deshacer then r.availability else 'agotado' end,
         updated_at = now()
    from agotados a, modo m, private.respaldo_2026_09_28 r
   where p.id = a.id and r.id = p.id
     and case when m.deshacer then p.active and p.availability = 'agotado'
                                   and (r.active is distinct from true or r.availability <> 'agotado')
              else not p.active or p.availability <> 'agotado' end
  returning p.id
)
insert into resumen
select 4, 'No están en el catálogo: visibles y Agotado',
       (select count(*) from hechos),
       (select count(*) from public.products p join agotados a using (id)
          join private.respaldo_2026_09_28 r using (id), modo m
         where case when m.deshacer then p.active = r.active and p.availability = r.availability
                    else p.active and p.availability = 'agotado' end),
       (select count(*) from agotados);

select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total
  from resumen order by orden;

-- «sin_cambiar» mayor que 0 en «Precios» = ese perfume ya tenía otro precio (lo cambiaste a mano): no se tocó.
-- FIN
