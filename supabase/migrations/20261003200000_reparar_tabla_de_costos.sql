-- REPARAR LA TABLA DE COSTOS — 3 de octubre de 2026
--
-- Por qué: en tu Supabase ya existía una tabla «product_costs» con otras columnas cuando corriste el script del
-- 30 de septiembre, y ese script solo la crea si no existe. Le faltan columnas que usa el panel (costs, strategy,
-- competitor_price, supplier): el panel no puede guardar costos y tu archivo privado de costos no carga.
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Guarda una copia exacta de la tabla como está ahora (private.product_costs_antes_20261003), solo la primera vez.
--   2. Agrega las columnas que faltan, sin borrar ninguna.
--   3. Si la tabla vieja tenía una sola columna con el costo, lo pasa a la columna nueva.
--   4. Las columnas viejas que el panel no usa dejan de ser obligatorias (así guardar no falla).
--   5. Quita los renglones sin costo, sin perfume o repetidos (siguen en la copia del paso 1).
--   6. Deja la tabla con la misma protección que las demás tablas privadas: solo el administrador la ve y la cambia (y
--      quita cualquier permiso viejo que dejara verla a un cliente con cuenta).
--   7. Avisa a la API de Supabase que la tabla cambió.
-- Al final muestra cómo quedó. Es seguro repetirlo. Después vuelve a correr tu archivo privado de costos.
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»). La primera línea empieza con «-- REPARAR LA TABLA DE COSTOS» y la última dice «-- FIN».

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null then
    raise exception 'Falta la migración de administrador. No se cambió nada.';
  end if;
  if to_regclass('public.product_costs') is null then
    raise exception 'No existe la tabla de costos: corre primero el script «FUNCIONES NUEVAS Y PERFUMES NUEVOS» (30 de septiembre). No se cambió nada.';
  end if;
end $$;

-- 0b) Turno: aparta la tabla de costos (solo la usa el panel) y los perfumes un instante, sin esperar con algo apartado.
do $$
begin
  for intento in 1..80 loop
    begin
      lock table public.product_costs in access exclusive mode nowait;
      lock table public.products in share row exclusive mode nowait;
      return;
    exception when lock_not_available then
      perform pg_sleep(0.25);
    end;
  end loop;
  raise exception 'La tienda está muy ocupada en este momento. Espera un minuto y vuelve a darle Run. No se cambió nada.';
end $$;

-- 1) Copia exacta de la tabla como está ahora (solo la primera vez).
create temp table reparacion (orden integer, cambio text, estado text) on commit drop;
do $$
declare
  v_n bigint;
begin
  if to_regclass('private.product_costs_antes_20261003') is null then
    execute 'create table private.product_costs_antes_20261003 as table public.product_costs';
    execute 'revoke all on private.product_costs_antes_20261003 from public, anon, authenticated';
    execute 'select count(*) from private.product_costs_antes_20261003' into v_n;
    insert into reparacion values (1, 'Copia de la tabla anterior', 'guardada: private.product_costs_antes_20261003 (' || v_n || ' renglones)');
  else
    execute 'select count(*) from private.product_costs_antes_20261003' into v_n;
    insert into reparacion values (1, 'Copia de la tabla anterior', 'ya estaba guardada: private.product_costs_antes_20261003 (' || v_n || ' renglones)');
  end if;
end $$;

-- 2) Columnas que faltan.
alter table public.product_costs add column if not exists costs numeric(12,2)[];
alter table public.product_costs add column if not exists strategy text not null default 'normal';
alter table public.product_costs add column if not exists competitor_price numeric(12,2);
alter table public.product_costs add column if not exists supplier text not null default 'La Grada';
alter table public.product_costs add column if not exists updated_at timestamptz not null default now();

-- 3, 4 y 5) Costo de la tabla vieja, columnas viejas opcionales, una sola fila por perfume y renglones sin costo.
do $$
declare
  v_old text[];
  v_cost text[];
  v_type regtype;
  v_pid smallint;
  v_pk text;
  v_moved bigint := 0;
  v_gone bigint := 0;
  v_n bigint;
  r record;
begin
  -- Columnas viejas: las que el panel no usa (sin contar números de renglón automáticos).
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}') into v_old
    from pg_attribute a
   where a.attrelid = 'public.product_costs'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('product_id', 'costs', 'strategy', 'competitor_price', 'supplier', 'updated_at');
  -- El costo viejo: una sola columna de números (o lista de números) que no sea un número de renglón ni de otra tabla.
  select coalesce(array_agg(a.attname::text), '{}') into v_cost
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.product_costs'::regclass and a.attname = any (v_old)
     and a.attidentity = '' and coalesce(pg_get_expr(d.adbin, d.adrelid), '') not like 'nextval(%'
     and a.attname <> 'id' and a.attname !~ '_id$'
     and (a.atttypid in ('numeric'::regtype, 'integer'::regtype, 'bigint'::regtype, 'smallint'::regtype, 'real'::regtype, 'double precision'::regtype)
          or t.typelem in ('numeric'::regtype, 'integer'::regtype, 'bigint'::regtype, 'smallint'::regtype, 'real'::regtype, 'double precision'::regtype));
  if cardinality(v_cost) = 1 then
    select a.atttypid::regtype into v_type from pg_attribute a where a.attrelid = 'public.product_costs'::regclass and a.attname = v_cost[1];
    if v_type::text like '%[]' then
      execute format('update public.product_costs set costs = (select array_agg(round(v::numeric, 2)) from unnest(%I) v) where costs is null and %I is not null and cardinality(%I) between 1 and 6 and 0 < all (%I)', v_cost[1], v_cost[1], v_cost[1], v_cost[1]);
    else
      execute format('update public.product_costs set costs = array[round(%I::numeric, 2)] where costs is null and %I is not null and %I > 0', v_cost[1], v_cost[1], v_cost[1]);
    end if;
    get diagnostics v_moved = row_count;
  end if;
  insert into reparacion values (2, 'Costo pasado de la tabla vieja',
    case when cardinality(v_cost) = 1 then v_moved || ' renglones (de la columna «' || v_cost[1] || '»)'
         when cardinality(v_cost) = 0 then 'no había una columna de costo'
         else 'no: había varias columnas de números (' || array_to_string(v_cost, ', ') || '); están en la copia' end);

  -- El número de perfume como número (por si la tabla vieja lo guardaba como texto).
  select a.atttypid::regtype into v_type from pg_attribute a where a.attrelid = 'public.product_costs'::regclass and a.attname = 'product_id';
  if v_type not in ('bigint'::regtype, 'integer'::regtype, 'smallint'::regtype) then
    execute 'alter table public.product_costs alter column product_id type bigint using nullif(regexp_replace(product_id::text, ''[^0-9]'', '''', ''g''), '''')::bigint';
  end if;

  -- Una sola fila por perfume: la llave de la tabla es el número de perfume.
  delete from public.product_costs where product_id is null or costs is null;
  get diagnostics v_n = row_count; v_gone := v_gone + v_n;
  delete from public.product_costs pc where not exists (select 1 from public.products p where p.id = pc.product_id);
  get diagnostics v_n = row_count; v_gone := v_gone + v_n;
  delete from public.product_costs a using public.product_costs b
   where a.product_id = b.product_id
     and (coalesce(a.updated_at, '-infinity'::timestamptz), a.ctid) < (coalesce(b.updated_at, '-infinity'::timestamptz), b.ctid);
  get diagnostics v_n = row_count; v_gone := v_gone + v_n;
  insert into reparacion values (3, 'Renglones sin costo, sin perfume o repetidos', case when v_gone = 0 then 'ninguno' else v_gone || ' quitados (siguen en la copia)' end);

  select attnum into v_pid from pg_attribute where attrelid = 'public.product_costs'::regclass and attname = 'product_id';
  select conname into v_pk from pg_constraint where conrelid = 'public.product_costs'::regclass and contype = 'p';
  if v_pk is not null and not exists (select 1 from pg_constraint where conrelid = 'public.product_costs'::regclass and contype = 'p' and conkey = array[v_pid]) then
    execute format('alter table public.product_costs drop constraint %I', v_pk);
    v_pk := null;
  end if;
  if v_pk is null then
    alter table public.product_costs add primary key (product_id);
  end if;
  alter table public.product_costs alter column costs set not null;

  -- Las columnas viejas ya no son obligatorias ni se llenan solas (el panel no las usa, y un contador automático viejo
  -- pediría permisos que el panel no tiene).
  for r in
    select a.attname, a.attnotnull, a.attidentity, pg_get_expr(d.adbin, d.adrelid) as def
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.product_costs'::regclass and a.attname = any (v_old)
  loop
    if r.attidentity <> '' then
      execute format('alter table public.product_costs alter column %I drop identity if exists', r.attname);
    elsif coalesce(r.def, '') like 'nextval(%' then
      execute format('alter table public.product_costs alter column %I drop default', r.attname);
    end if;
    if r.attnotnull then
      execute format('alter table public.product_costs alter column %I drop not null', r.attname);
    end if;
  end loop;
  insert into reparacion values (4, 'Columnas viejas que quedaron (ya no obligatorias)', case when cardinality(v_old) = 0 then 'ninguna' else array_to_string(v_old, ', ') end);

  if not exists (select 1 from pg_constraint where conrelid = 'public.product_costs'::regclass and contype = 'f' and confrelid = 'public.products'::regclass) then
    alter table public.product_costs add constraint product_costs_product_id_fkey foreign key (product_id) references public.products (id) on delete cascade;
  end if;
end $$;

-- Reglas de cada columna (las mismas del script del 30-sep).
alter table public.product_costs drop constraint if exists product_costs_costs_valid;
alter table public.product_costs add constraint product_costs_costs_valid check (cardinality(costs) between 1 and 6 and 0 < all (costs));
alter table public.product_costs drop constraint if exists product_costs_strategy_valid;
alter table public.product_costs add constraint product_costs_strategy_valid check (strategy in ('gancho', 'normal', 'exclusivo'));
alter table public.product_costs drop constraint if exists product_costs_competitor_valid;
alter table public.product_costs add constraint product_costs_competitor_valid check (competitor_price is null or competitor_price > 0);
alter table public.product_costs drop constraint if exists product_costs_supplier_valid;
alter table public.product_costs add constraint product_costs_supplier_valid check (length(supplier) <= 60);

-- 6) Protección: solo el administrador (y se quitan permisos o políticas viejas).
alter table public.product_costs enable row level security;
revoke all on public.product_costs from public, anon, authenticated;
grant select, insert, update, delete on public.product_costs to authenticated;
do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'product_costs' loop
    execute format('drop policy %I on public.product_costs', r.policyname);
  end loop;
end $$;
create policy "Admins gestionan costos" on public.product_costs for all to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

-- 7) La API de Supabase vuelve a leer la tabla (si no, seguiría sin ver las columnas nuevas).
notify pgrst, 'reload schema';

insert into reparacion
select 5, 'Columnas de la tabla de costos', string_agg(a.attname, ', ' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.product_costs'::regclass and a.attnum > 0 and not a.attisdropped;
insert into reparacion select 6, 'Perfumes con costo', count(*)::text from public.product_costs;
insert into reparacion
select 7, 'Quién la puede ver',
       case when c.relrowsecurity and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'product_costs') = 1
                 and not has_table_privilege('anon', 'public.product_costs', 'select')
            then 'solo el administrador' else 'REVISAR' end
  from pg_class c where c.oid = 'public.product_costs'::regclass;
select cambio, estado from reparacion order by orden;
-- FIN
