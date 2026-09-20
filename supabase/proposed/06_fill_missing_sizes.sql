-- PLANTILLA — NO SE EJECUTA TAL CUAL. Completa cada valor con la presentación real
-- verificada en la caja o con el proveedor y luego descomenta la sentencia.
--
-- Tres productos del catálogo no tienen tamaño (size vacío). La lámina original
-- tampoco lo indica, así que no se inventa un valor:
--
--   * Diesel Plus Plus Man        (la caja parece indicar 75 ML / 2.5 FL OZ; confírmalo)
--   * Dior Sauvage EDP            (sin dato en la lámina)
--   * Set - Collection 8 In 1 Game Of Spades (sin dato; suele indicarse por frasco, p. ej. 8 x 10 ML)
--
-- Puedes hacerlo desde el panel (Edición de perfumes -> Tamaño) o con SQL:

-- update public.products set size = '75 ML'  where name = 'Diesel Plus Plus Man' and coalesce(size,'') = '';
-- update public.products set size = '100 ML' where name = 'Dior Sauvage EDP'     and coalesce(size,'') = '';
-- update public.products set size = '8 x 10 ML' where name = 'Set - Collection 8 In 1 Game Of Spades' and coalesce(size,'') = '';

-- Comprobación posterior (debe devolver 0 filas):
-- select id, name from public.products where active and coalesce(size,'') = '';
