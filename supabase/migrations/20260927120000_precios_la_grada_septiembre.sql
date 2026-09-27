-- PRECIOS NUEVOS — catálogo de La Grada de septiembre de 2026
--
-- Qué hace (todo de una vez, en una sola operación: si algo falla, no se cambia nada):
--   1. SUBE el precio normal de 275 perfumes.
--   2. Crea 26 OFERTAS («Precio especial», hasta el 31-oct-2026 a las 11:59 p. m.):
--      Antes = tu precio de hoy, Ahora = el precio nuevo. Al vencer, el precio vuelve solo al de antes.
--   3. OCULTA 78 perfumes que no aparecen en el catálogo nuevo (no se borran: vuelven a
--      verse marcando «Activo» en el panel, o ejecutando este mismo archivo en modo deshacer).
--   Los demás perfumes (se mantienen) no se tocan.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este archivo → Run.
-- Al final verás una tabla con lo que se cambió.
--
-- Es seguro repetirlo: solo cambia un perfume si su precio sigue igual al de hoy. Si ya cambiaste
-- alguno a mano en el panel, se respeta y aparece en la columna «sin_cambiar».
--
-- DESHACER: cambia «false» por «true» en la línea «modo(deshacer)» y vuelve a ejecutarlo.
-- Devuelve los precios de antes, quita estas ofertas y vuelve a mostrar los perfumes ocultos.
--
-- La lista pública de precios está en data/precios-2026-09.json (las pruebas de la web la usan).

with modo(deshacer) as (values (false)),

subir(id, antes, nuevo) as (values
    (1::bigint, 'RD$4,500', 'RD$5,150'),  -- 212 Sexy EDT Men
    (2, 'RD$4,900', 'RD$6,650'),  -- 212 VIP EDT NY Men
    (3, 'RD$6,550', 'RD$6,950'),  -- 212 VIP NYC EDP Women
    (4, 'RD$6,550', 'RD$6,950'),  -- 212 VIP Black EDP Men
    (5, 'RD$7,500', 'RD$7,850'),  -- 212 VIP Rosé EDP Women
    (6, 'RD$3,450', 'RD$3,950'),  -- 360 Collection For Men EDT
    (7, 'RD$3,000', 'RD$3,350'),  -- 360 Red EDP Women
    (8, 'RD$3,000', 'RD$3,350'),  -- 360 Red EDP Men
    (9, 'RD$3,000', 'RD$3,350'),  -- 360 White EDT Women
    (13, 'RD$3,150', 'RD$3,350'),  -- 9 PM Rebel Men Afnan
    (15, 'RD$5,900', 'RD$6,250'),  -- Acqua di Giò EDT Men
    (16, 'RD$6,550', 'RD$6,950'),  -- Acqua di Giò Profondo EDP Men
    (17, 'RD$3,000', 'RD$3,350'),  -- Afeef EDP Unisex
    (18, 'RD$2,750', 'RD$3,050'),  -- Afnan Rare Carbon
    (20, 'RD$2,900', 'RD$3,250'),  -- Lattafa Tharwah Silver
    (22, 'RD$3,000', 'RD$3,350'),  -- Afnan Zimaya Tiramisu Coco
    (25, 'RD$2,750', 'RD$3,050'),  -- Jean Lowe Azure EDP Spray
    (26, 'RD$2,750', 'RD$3,050'),  -- Jean Lowe Vibe EDP Spray
    (28, 'RD$3,150 / RD$3,750', 'RD$3,450 / RD$4,150'),  -- Al Haramain Gold Edition
    (29, 'RD$3,450 / RD$3,750', 'RD$3,950 / RD$4,350'),  -- Al Haramain Ruby
    (30, 'RD$3,150', 'RD$3,550'),  -- Al Haramain White
    (31, 'RD$3,750', 'RD$3,950'),  -- Al Haramain Aqua Dubai
    (33, 'RD$2,400', 'RD$2,650'),  -- Ana Abiyedh Coral EDP Spray
    (34, 'RD$3,750', 'RD$4,350'),  -- Ariana Grande Thank U Next
    (35, 'RD$4,400', 'RD$5,050'),  -- Ariana Grande Ari
    (36, 'RD$4,400', 'RD$4,850'),  -- Ariana Grande Cloud
    (37, 'RD$4,400', 'RD$5,050'),  -- Ariana Grande Cloud Intense 2.0
    (38, 'RD$4,400', 'RD$5,050'),  -- Ariana Grande Cloud Pink
    (39, 'RD$3,750', 'RD$4,350'),  -- Ariana Grande Moonlight
    (40, 'RD$3,750', 'RD$4,350'),  -- Ariana Grande Sweet Like Candy
    (41, 'RD$3,400', 'RD$3,550'),  -- Armaf Beach Party
    (43, 'RD$4,000', 'RD$4,550'),  -- Armaf Club de Nuit Précieux I
    (46, 'RD$4,000', 'RD$4,550'),  -- Armaf Club de Nuit Précieux IV
    (47, 'RD$2,650', 'RD$2,850'),  -- Armaf Club de Nuit Women
    (48, 'RD$3,250', 'RD$3,650'),  -- Armaf Club de Nuit Blue Iconic
    (49, 'RD$3,250', 'RD$3,450'),  -- Armaf Club de Nuit Impériale
    (52, 'RD$3,050', 'RD$3,450'),  -- Armaf Club de Nuit Milestone
    (53, 'RD$3,050', 'RD$3,450'),  -- Armaf Club de Nuit Sillage
    (54, 'RD$3,250', 'RD$3,450'),  -- Armaf Club de Nuit Untold
    (55, 'RD$3,050', 'RD$3,450'),  -- Armaf Club de Nuit Urban Elixir
    (61, 'RD$3,000', 'RD$3,350'),  -- Armaf Miss Attitude
    (63, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Aoud Edition
    (64, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Aqua
    (68, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Candee Woman
    (70, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Homme
    (71, 'RD$2,750 / RD$3,600', 'RD$2,850 / RD$3,600'),  -- Armaf Odyssey Homme White
    (72, 'RD$2,750', 'RD$3,050'),  -- Armaf Odyssey Limoni
    (74, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Mega
    (75, 'RD$3,300', 'RD$3,550'),  -- Armaf Odyssey Montagne
    (76, 'RD$3,300', 'RD$3,750'),  -- Armaf Odyssey Revolution
    (77, 'RD$2,750', 'RD$3,050'),  -- Armaf Odyssey Spectra
    (79, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Tyrant
    (80, 'RD$2,750', 'RD$2,850'),  -- Armaf Odyssey Wild One
    (81, 'RD$6,400', 'RD$6,950'),  -- Armani Code
    (82, 'RD$8,100', 'RD$8,450'),  -- Armani Stronger With You EDP
    (83, 'RD$4,900', 'RD$5,450'),  -- Armani Stronger With You EDT
    (87, 'RD$2,550', 'RD$2,750'),  -- Lattafa Asad
    (88, 'RD$2,650', 'RD$2,750'),  -- Lattafa Asad Zanzibar
    (89, 'RD$2,750', 'RD$3,050'),  -- Lattafa Atlas
    (90, 'RD$4,500', 'RD$5,150'),  -- Azzaro Most Wanted Toilette
    (91, 'RD$4,450', 'RD$5,150'),  -- Azzaro Most Wanted EDP
    (92, 'RD$5,400', 'RD$6,050'),  -- Azzaro Most Wanted EDT Intense
    (93, 'RD$2,450', 'RD$2,750'),  -- Lattafa Bade'e Al Oud Amethyst
    (94, 'RD$2,450', 'RD$2,550'),  -- Lattafa Bade'e Al Oud For Glory
    (95, 'RD$2,650', 'RD$2,750'),  -- Lattafa Bade'e Al Oud Honor & Glory
    (96, 'RD$2,450', 'RD$2,750'),  -- Lattafa Bade'e Al Oud Sublime
    (97, 'RD$2,750', 'RD$2,850'),  -- Lattafa Bade'e Al Oud Noble Blush
    (98, 'RD$2,450', 'RD$2,750'),  -- Bharara Champagne Black
    (99, 'RD$3,750', 'RD$4,350'),  -- Lolita Lempicka Women
    (100, 'RD$4,400', 'RD$5,050'),  -- Bharara Chocolate
    (102, 'RD$4,100', 'RD$4,750'),  -- Bharara King
    (106, 'RD$2,750', 'RD$3,050'),  -- Bharara Rome Pour Femme
    (107, 'RD$2,750', 'RD$3,050'),  -- Bharara Rome Pour Homme
    (108, 'RD$2,900', 'RD$3,250'),  -- Versace Blue Jeans Men
    (112, 'RD$2,750', 'RD$3,050'),  -- Britney Spears Fantasy EDP
    (113, 'RD$3,300', 'RD$3,750'),  -- Calvin Klein Eternity Men
    (114, 'RD$3,500', 'RD$3,950'),  -- Calvin Klein Eternity Women
    (115, 'RD$2,650', 'RD$2,950'),  -- Calvin Klein Obsession
    (116, 'RD$2,900', 'RD$3,150'),  -- Calvin Klein One
    (117, 'RD$5,200', 'RD$5,850'),  -- Carolina Herrera Bad Boy Cobalt Men
    (118, 'RD$10,050', 'RD$10,350'),  -- Carolina Herrera La Bomba
    (119, 'RD$4,450', 'RD$5,150'),  -- Coach New York Wild Rose
    (120, 'RD$2,300', 'RD$2,550'),  -- Lattafa Confidential Platinum
    (121, 'RD$2,300', 'RD$2,550'),  -- Lattafa Confidential Private Gold
    (122, 'RD$2,000', 'RD$2,150'),  -- Diesel Plus Plus Man
    (123, 'RD$2,000', 'RD$2,150'),  -- Diesel Plus Plus Women
    (129, 'RD$5,550', 'RD$6,150'),  -- Dior Sauvage Men Antiguo EDT
    (130, 'RD$8,500', 'RD$8,650'),  -- Dior Sauvage EDT Men
    (131, 'RD$10,300', 'RD$10,550'),  -- Dior Sauvage Elixir
    (132, 'RD$4,600', 'RD$5,250'),  -- Dolce & Gabbana Devotion
    (133, 'RD$4,450', 'RD$4,950'),  -- Dolce & Gabbana Light Blue Men
    (134, 'RD$4,450', 'RD$4,950'),  -- Dolce & Gabbana Light Blue Women
    (135, 'RD$4,900', 'RD$5,650'),  -- Dolce & Gabbana The One
    (136, 'RD$5,200', 'RD$5,850'),  -- Dolce & Gabbana The One Gold Intense
    (138, 'RD$2,750', 'RD$3,050'),  -- Donna Intense Stallion
    (139, 'RD$3,000', 'RD$3,350'),  -- Dumont Nitro Blue
    (140, 'RD$3,000', 'RD$3,350'),  -- Dumont Nitro Platinum
    (141, 'RD$3,000', 'RD$3,350'),  -- Dumont Nitro Intense
    (142, 'RD$3,000', 'RD$3,350'),  -- Dumont Nitro Red
    (143, 'RD$3,000', 'RD$3,350'),  -- Dumont Nitro White Men
    (144, 'RD$2,750', 'RD$2,950'),  -- Lattafa Eclaire
    (146, 'RD$3,100', 'RD$3,550'),  -- Lattafa Emeer
    (147, 'RD$2,750', 'RD$3,050'),  -- Britney Spears Fantasy Circus Women
    (148, 'RD$2,750', 'RD$3,050'),  -- Lomani Paris Millionaire Spirit
    (152, 'RD$3,450', 'RD$3,950'),  -- French Avenue Aether Extrait
    (153, 'RD$3,750', 'RD$3,950'),  -- French Avenue Atlantis Extrait
    (154, 'RD$2,400', 'RD$2,650'),  -- Barakkat Rouge 540 Red
    (155, 'RD$2,400', 'RD$2,650'),  -- Barakkat Rouge 540 Extrait EDP
    (156, 'RD$3,150', 'RD$3,350'),  -- French Avenue Liquid Brun
    (157, 'RD$4,700', 'RD$5,350'),  -- Game of Spades Bid
    (158, 'RD$4,900', 'RD$5,350'),  -- Game of Spades Blind Bid
    (161, 'RD$4,700', 'RD$4,950'),  -- Game of Spades Diamond
    (167, 'RD$4,700', 'RD$4,950'),  -- Game of Spades King
    (171, 'RD$4,700', 'RD$5,350'),  -- Game of Spades Queen
    (172, 'RD$4,700', 'RD$4,950'),  -- Game of Spades Rouge Extrait
    (173, 'RD$4,700', 'RD$5,350'),  -- Game of Spades Rouge Parfum
    (174, 'RD$4,800', 'RD$4,950'),  -- Game of Spades Royale
    (176, 'RD$5,150', 'RD$5,350'),  -- Game of Spades Topaz
    (177, 'RD$4,700', 'RD$4,950'),  -- Game of Spades Wildcard
    (178, 'RD$4,700', 'RD$4,950'),  -- Game of Spades Win
    (179, 'RD$4,700', 'RD$5,350'),  -- Game of Spades Yellow Sapphire
    (180, 'RD$4,900', 'RD$5,350'),  -- Game of Spades All-In
    (181, 'RD$2,750', 'RD$3,050'),  -- Guess Seductive Homme Men
    (182, 'RD$2,900', 'RD$3,250'),  -- Guess Seductive Homme Men
    (186, 'RD$3,300', 'RD$3,550'),  -- Her Confession
    (187, 'RD$3,300', 'RD$3,550'),  -- His Confession
    (188, 'RD$3,300', 'RD$3,750'),  -- Hugo XY Men
    (189, 'RD$6,350', 'RD$6,650'),  -- Paco Rabanne Invictus
    (190, 'RD$6,750', 'RD$6,950'),  -- Paco Rabanne Invictus Parfum
    (191, 'RD$2,900', 'RD$3,050'),  -- Ishq Al Shuyukh Silver
    (192, 'RD$2,900', 'RD$3,050'),  -- Ishq Al Shuyukh Gold
    (193, 'RD$4,000', 'RD$4,550'),  -- Issey Miyake Intense
    (194, 'RD$4,000', 'RD$4,550'),  -- Issey Miyake L'Eau d'Issey
    (195, 'RD$4,000', 'RD$4,550'),  -- Issey Miyake Pour Homme
    (196, 'RD$3,000', 'RD$3,350'),  -- Issey Miyake Sport
    (197, 'RD$8,950', 'RD$9,250'),  -- JPG Divine EDP Intense
    (198, 'RD$7,900', 'RD$8,250'),  -- JPG La Belle Paradise Garden
    (199, 'RD$6,650', 'RD$6,950'),  -- JPG Le Beau 2.5 EDT Men
    (200, 'RD$7,350', 'RD$7,750'),  -- JPG Le Beau 4.2 EDT Men
    (201, 'RD$8,050', 'RD$8,450'),  -- JPG Le Beau Le Parfum 4.2 EDP
    (202, 'RD$8,800', 'RD$9,150'),  -- JPG Le Beau Paradise Garden
    (203, 'RD$7,350', 'RD$7,750'),  -- JPG Le Male 4.2 EDT Men
    (204, 'RD$7,500', 'RD$7,850'),  -- JPG Le Male Elixir 2.5 EDP Men
    (205, 'RD$8,050', 'RD$8,250'),  -- JPG Le Male Elixir 4.2 EDP Men
    (206, 'RD$7,350', 'RD$7,750'),  -- JPG Le Male Le Parfum 2.5 EDP Men
    (207, 'RD$8,400', 'RD$8,750'),  -- JPG Scandal Le Parfum 3.4 EDP Men
    (208, 'RD$7,850', 'RD$8,250'),  -- JPG Ultra Male 4.2 Intense
    (209, 'RD$8,200', 'RD$8,550'),  -- JPG Le Beau Flower Edition
    (210, 'RD$2,750', 'RD$2,950'),  -- Joop Homme EDT 4.2 EDT Men
    (211, 'RD$2,750', 'RD$2,850'),  -- Lattafa Khamrah
    (212, 'RD$3,100', 'RD$3,250'),  -- Lattafa Khamrah Dukhan
    (213, 'RD$2,800', 'RD$3,050'),  -- Lattafa Khamrah Qahw
    (214, 'RD$8,050', 'RD$8,450'),  -- Lacoste L.12.12 Blanc, Pure White
    (215, 'RD$8,050', 'RD$8,450'),  -- Lancome La Vie Est Belle
    (216, 'RD$8,950', 'RD$9,250'),  -- Lancome La Vie Est Belle L'Elixir
    (219, 'RD$3,200', 'RD$3,650'),  -- Lattafa Angham
    (220, 'RD$2,450', 'RD$2,550'),  -- Maison Alhambra Delilah
    (222, 'RD$4,450', 'RD$5,150'),  -- Coach New York Blue
    (231, 'RD$2,450', 'RD$2,550'),  -- Lattafa Fakhar Gold Extrait
    (232, 'RD$3,400', 'RD$3,550'),  -- Lattafa Give Me Gourman Whipped Pleasure
    (233, 'RD$3,400', 'RD$3,550'),  -- Lattafa Give Me Gourmand Choco Overdose
    (234, 'RD$3,400', 'RD$3,550'),  -- Lattafa Give Me Gourman Cookie Crave
    (236, 'RD$3,400', 'RD$3,550'),  -- Lattafa Give Me Gourmand Vanilla Freak
    (241, 'RD$3,350', 'RD$3,550'),  -- Lattafa La Collection D'Antiquites 1886
    (244, 'RD$2,650', 'RD$2,850'),  -- Lattafa Mayar Women
    (245, 'RD$2,750', 'RD$2,850'),  -- Lattafa Mayar Cherry Intense
    (246, 'RD$2,700', 'RD$2,850'),  -- Lattafa Mayar Natural Intense
    (247, 'RD$3,250', 'RD$3,350'),  -- Lattafa Musamam White Intense
    (251, 'RD$3,250', 'RD$3,350'),  -- Lattafa Pride Art Of Nature II
    (253, 'RD$2,900', 'RD$3,050'),  -- Lattafa Pride Al Qiam Silver
    (254, 'RD$2,900', 'RD$3,050'),  -- Lattafa Pride Ansaam Silver
    (256, 'RD$2,750', 'RD$2,850'),  -- Lattafa The Kingdom Men
    (259, 'RD$2,750', 'RD$2,850'),  -- Lattafa The Kingdom Women
    (261, 'RD$2,900', 'RD$3,050'),  -- Lattafa Pride Shaheen Gold
    (262, 'RD$2,750', 'RD$2,850'),  -- Lattafa Pride Vintage Radio
    (264, 'RD$2,450', 'RD$2,550'),  -- Lattafa Qaed Al Fursan Unlimited
    (269, 'RD$2,400', 'RD$2,550'),  -- Lattafa Rave Now Black
    (270, 'RD$2,450', 'RD$2,550'),  -- Lattafa Rave Now
    (271, 'RD$2,650', 'RD$2,850'),  -- Zimaya Fatima Pink
    (273, 'RD$3,400', 'RD$3,550'),  -- Lattafa Taureau De Combat
    (274, 'RD$3,000', 'RD$3,250'),  -- Lattafa Teriaq
    (275, 'RD$3,300', 'RD$3,550'),  -- Lattafa Teriaq Intense
    (276, 'RD$2,900', 'RD$3,050'),  -- Lattafa Tharwah Gold
    (280, 'RD$2,450', 'RD$2,550'),  -- Maison Alhambra La Voie
    (281, 'RD$2,450', 'RD$2,550'),  -- Maison Alhambra Salvo
    (282, 'RD$4,500', 'RD$5,150'),  -- Mont Blanc Legend EDP
    (283, 'RD$5,850', 'RD$6,650'),  -- Mancera Instant Crush
    (284, 'RD$3,300', 'RD$3,750'),  -- Mont Blanc Explorer Platinum
    (285, 'RD$4,600', 'RD$5,250'),  -- Mont Blanc Emblem Men
    (286, 'RD$3,750', 'RD$4,350'),  -- Mont Blanc Explorer EDP
    (288, 'RD$3,750', 'RD$4,350'),  -- Givenchy Pi Men
    (289, 'RD$3,750', 'RD$4,350'),  -- Mont Blanc Legend Spirit
    (290, 'RD$3,750', 'RD$4,350'),  -- Mont Blanc Signature Absolue
    (291, 'RD$6,400', 'RD$6,950'),  -- Montale Paris Starry Nights
    (292, 'RD$3,900', 'RD$4,450'),  -- Moschino Toy 2
    (293, 'RD$3,900', 'RD$4,450'),  -- Moschino Toy 2 Bubble Gum
    (294, 'RD$3,900', 'RD$4,450'),  -- Moschino Toy 2 Pearl
    (295, 'RD$3,900', 'RD$4,450'),  -- Moschino Toy Boy
    (296, 'RD$2,300', 'RD$2,550'),  -- Nautica Blue
    (297, 'RD$2,300', 'RD$2,550'),  -- Nautica Classic
    (300, 'RD$4,650', 'RD$5,350'),  -- Mont Blanc Legend EDP
    (301, 'RD$4,900', 'RD$5,650'),  -- Orientica Oud Saffron
    (302, 'RD$4,900', 'RD$5,650'),  -- Orientica Royal Bleu
    (303, 'RD$4,900', 'RD$5,650'),  -- Orientica Velvet Gold
    (304, 'RD$8,050', 'RD$8,450'),  -- Paco Invictus Victory EDP
    (305, 'RD$7,500', 'RD$7,850'),  -- Paco Invictus Victory Elixir Men Intense
    (306, 'RD$6,850', 'RD$7,350'),  -- Paco Olympea Women
    (307, 'RD$6,550', 'RD$6,950'),  -- Paco One Million EDP Men
    (308, 'RD$5,400', 'RD$5,850'),  -- Paco One Million EDT Men
    (309, 'RD$6,400', 'RD$6,950'),  -- Paco Rabanne Phantom EDT Men
    (311, 'RD$4,000', 'RD$4,550'),  -- Rasasi Hawas London
    (314, 'RD$5,800', 'RD$6,450'),  -- Prada Luna Rossa EDT
    (315, 'RD$6,650', 'RD$6,950'),  -- Prada Luna Rossa Ocean
    (316, 'RD$9,050', 'RD$9,350'),  -- Prada Paradoxe
    (318, 'RD$2,750', 'RD$2,950'),  -- Rasasi Hawas For Him
    (322, 'RD$3,600', 'RD$3,950'),  -- Rasasi Hawas Eclat
    (323, 'RD$3,450', 'RD$3,550'),  -- Rasasi Hawas Elixir Men
    (324, 'RD$3,450', 'RD$3,550'),  -- Rasasi Hawas Fire Men
    (326, 'RD$3,650', 'RD$3,950'),  -- Rasasi Hawas Tropical
    (327, 'RD$2,750', 'RD$3,050'),  -- Rayhaan Elixir
    (328, 'RD$2,450', 'RD$2,750'),  -- Rayhaan Imperia
    (329, 'RD$2,900', 'RD$3,250'),  -- Versce Red Jeans Women
    (332, 'RD$3,450', 'RD$3,950'),  -- Afnan 9AM Dive Set 3PC
    (333, 'RD$3,450', 'RD$3,950'),  -- Set Yara And Candy
    (334, 'RD$3,650', 'RD$4,150'),  -- Set - Afnan 9PM 3PCS
    (336, 'RD$3,900', 'RD$4,450'),  -- Set Armaf Club De Nuit Intense 4 Piece Gift
    (337, 'RD$3,900', 'RD$4,450'),  -- Set Club De Nuit For Women 4PCS
    (338, 'RD$3,750', 'RD$4,350'),  -- Set - Armaf Odyssey Limoni 4PCS
    (339, 'RD$3,900', 'RD$4,450'),  -- Set Odyssey Mandarin Sky 4PCS
    (340, 'RD$6,200', 'RD$6,750'),  -- Set - Yves Saint Laurent 2PCS
    (346, 'RD$6,200', 'RD$6,750'),  -- Set - Azzaro Wanted Eau De Parfum
    (347, 'RD$3,450', 'RD$3,950'),  -- Yara Gift Set
    (351, 'RD$8,400', 'RD$8,750'),  -- Set - Collection Esmeralda & Wilcard
    (353, 'RD$3,450', 'RD$3,950'),  -- Set - Yara Rosado 3PCS
    (356, 'RD$2,900', 'RD$3,050'),  -- Set - Joop Homme 2PCS
    (357, 'RD$3,750', 'RD$4,350'),  -- Set - Lattafa Angham 3PCS
    (359, 'RD$3,450', 'RD$3,950'),  -- Set - Lattafa Yara Collection 25ML 4PCS
    (361, 'RD$3,750', 'RD$3,950'),  -- Set - Lattafa Badee Al Oud Noble Blush 3PCS
    (363, 'RD$3,450', 'RD$3,950'),  -- Set - Lattafa Badee Sublime 3PCS
    (366, 'RD$3,250', 'RD$3,950'),  -- Set - Eclaire 2PCS
    (368, 'RD$3,950', 'RD$4,550'),  -- Set - Lattafa Pride Art Of Universe 3PCS
    (370, 'RD$5,300', 'RD$5,950'),  -- Set - Moschino Toy Boy 3PCS
    (373, 'RD$6,550', 'RD$6,950'),  -- Spicebomb Dark Leather
    (374, 'RD$6,550', 'RD$6,950'),  -- Spicebomb Night Vision
    (375, 'RD$5,500', 'RD$6,150'),  -- Spicebomb EDT Men
    (376, 'RD$2,550', 'RD$2,850'),  -- Emper Stallion 53
    (377, 'RD$2,650', 'RD$2,950'),  -- Emper Elixir 88
    (378, 'RD$2,750', 'RD$2,850'),  -- Emper Intenso
    (379, 'RD$2,750', 'RD$2,850'),  -- Stallion 53 Captcha 36
    (381, 'RD$2,900', 'RD$3,050'),  -- Emper Stallion 9 To 9 Gold
    (382, 'RD$2,900', 'RD$3,250'),  -- Emper Stallion Uomo Intense
    (384, 'RD$10,050', 'RD$10,350'),  -- Valentino Boirn In Roma Intense
    (385, 'RD$8,600', 'RD$8,950'),  -- Valentino Born In Roma Coral Fantasy
    (386, 'RD$8,950', 'RD$9,250'),  -- Valentino Born In Roma Coral Fantasy
    (387, 'RD$8,100', 'RD$8,450'),  -- Valentino Born In Roma Green Stravaganza
    (388, 'RD$10,150', 'RD$10,450'),  -- Valentino Born In Roma Intense Women
    (389, 'RD$8,950', 'RD$9,250'),  -- Valentino Donna Born In Roma Women
    (390, 'RD$7,350', 'RD$7,750'),  -- Valentino Donna Women EDP
    (391, 'RD$10,050', 'RD$10,350'),  -- Valentino Uomo Born In Roma Extradose
    (392, 'RD$6,450', 'RD$6,950'),  -- Versace Bright Cryst Women EDP
    (393, 'RD$3,450', 'RD$3,950'),  -- Versace Dreamer EDT
    (394, 'RD$4,100', 'RD$4,750'),  -- Versace Dylan Blue EDT
    (395, 'RD$4,200', 'RD$4,650'),  -- Versace Eros EDT Men
    (396, 'RD$5,500', 'RD$5,950'),  -- Versace Eros Eu De Parfum Men
    (397, 'RD$5,500', 'RD$6,150'),  -- Versace Eros Parfum Men
    (399, 'RD$5,800', 'RD$6,450'),  -- Versace Eros Flame EDP Men
    (400, 'RD$9,350', 'RD$9,650'),  -- Versace Eros Najim
    (401, 'RD$14,700', 'RD$15,250'),  -- Xerjoff Erba Pura EDP Unisex
    (408, 'RD$2,550', 'RD$2,750'),  -- Yara Tous
    (409, 'RD$8,000', 'RD$8,350'),  -- YSL Libre Eau Le Parfum Women
    (410, 'RD$7,700', 'RD$8,050'),  -- YSL Libre Le Parfum Women
    (411, 'RD$8,000', 'RD$8,350'),  -- YSL Y EDT Men
    (412, 'RD$9,350', 'RD$9,650'),  -- Yves Saint Laurent EDP Men
    (418, 'RD$2,750', 'RD$3,050'),  -- Zakat Z9
    (420, 'RD$3,750', 'RD$4,150')  -- 9PM Out Night
),

ofertas(id, antes, ahora) as (values
    (23::bigint, 'RD$3,050', 'RD$2,950'),  -- Lattafa Winners Trophy Silver
    (27, 'RD$5,800', 'RD$3,950'),  -- Al Haramain Dubai Night
    (57, 'RD$3,900', 'RD$3,550'),  -- Armaf Island Bliss Delights
    (58, 'RD$3,900', 'RD$3,550'),  -- Armaf Yum Yum
    (59, 'RD$3,900', 'RD$3,550'),  -- Armaf Island Bon Bon Delights
    (60, 'RD$3,900', 'RD$3,550'),  -- Armaf Island Breeze Delights
    (65, 'RD$3,300', 'RD$3,050'),  -- Armaf Odyssey Artisto
    (66, 'RD$3,400', 'RD$3,050'),  -- Armaf Odyssey Bahamas
    (128, 'RD$10,650', 'RD$10,250'),  -- Dior Sauvage EDP
    (159, 'RD$5,150', 'RD$4,950'),  -- Game of Spades Bonus
    (169, 'RD$5,200', 'RD$4,950'),  -- Game of Spades No Limit
    (221, 'RD$2,750', 'RD$2,550'),  -- Lattafa Asad Bourbon
    (227, 'RD$3,200', 'RD$3,050'),  -- Lattafa Eclaire Banoffi
    (228, 'RD$3,200', 'RD$3,050'),  -- Lattafa Eclaire Pistache
    (237, 'RD$3,150', 'RD$3,050'),  -- Lattafa Habik For Men
    (248, 'RD$3,250', 'RD$3,050'),  -- Lattafa Musamam
    (299, 'RD$3,650', 'RD$3,550'),  -- Nitro Red Intensely
    (317, 'RD$3,650', 'RD$3,450'),  -- Rasasi Hawas Ice
    (319, 'RD$3,750', 'RD$3,550'),  -- Rasasi Hawas Atlantis
    (321, 'RD$3,750', 'RD$3,550'),  -- Rasasi Hawas Malibu
    (355, 'RD$5,550', 'RD$4,750'),  -- Set - Game Of Spades Collection 3PCS
    (360, 'RD$3,450', 'RD$3,050'),  -- Set - Lattafa Asad Men Black 3PCS
    (369, 'RD$3,750', 'RD$3,350'),  -- Set De Asad Bourbon
    (398, 'RD$7,700', 'RD$6,050'),  -- Versace Eros Energy EDP Men
    (402, 'RD$12,700', 'RD$12,350'),  -- Blue Chanel
    (405, 'RD$3,450', 'RD$3,050')  -- Yara Elixir EDP
),

ocultar(id) as (values
    (14::bigint),  -- 9AM White EDP Women Afnan
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
    (417)  -- Zakat Z 7
),

cambio_subir as (
  update public.products p
     set price = case when m.deshacer then s.antes else s.nuevo end,
         updated_at = now()
    from subir s, modo m
   where p.id = s.id
     and p.original_price is null
     and p.price = case when m.deshacer then s.nuevo else s.antes end
  returning p.id
),

cambio_ofertas as (
  update public.products p
     set original_price = case when m.deshacer then null else o.antes end,
         price          = case when m.deshacer then o.antes else o.ahora end,
         offer_label    = case when m.deshacer then null else 'Precio especial' end,
         offer_ends_at  = case when m.deshacer then null else timestamptz '2026-10-31 23:59:00-04' end,
         updated_at = now()
    from ofertas o, modo m
   where p.id = o.id
     and case when m.deshacer then p.price = o.ahora and p.original_price = o.antes
              else p.price = o.antes and p.original_price is null end
  returning p.id
),

cambio_ocultar as (
  update public.products p
     set active = m.deshacer,
         updated_at = now()
    from ocultar h, modo m
   where p.id = h.id
     and p.active is distinct from m.deshacer
  returning p.id
)

select cambio, hechos_ahora, ya_estaban, total - hechos_ahora - ya_estaban as sin_cambiar, total from (
select 'Precios normales subidos' as cambio,
       (select count(*) from cambio_subir) as hechos_ahora,
       (select count(*) from public.products p join subir s using (id), modo m
         where p.original_price is null and p.price = case when m.deshacer then s.antes else s.nuevo end) as ya_estaban,
       (select count(*) from subir) as total
union all
select 'Ofertas creadas',
       (select count(*) from cambio_ofertas),
       (select count(*) from public.products p join ofertas o using (id), modo m
         where case when m.deshacer then p.price = o.antes and p.original_price is null
                    else p.price = o.ahora and p.original_price = o.antes end),
       (select count(*) from ofertas)
union all
select 'Perfumes ocultos',
       (select count(*) from cambio_ocultar),
       (select count(*) from public.products p join ocultar h using (id), modo m where p.active = m.deshacer),
       (select count(*) from ocultar)
) resumen;

-- «sin_cambiar» mayor que 0 = alguno de esos perfumes ya tenía otro precio (lo cambiaste a mano): no se tocó.
-- Para revisarlos, ejecuta aparte:
--   select id, name, price, original_price, active from public.products where id in (<IDs>) order by id;
