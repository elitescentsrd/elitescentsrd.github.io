// Prueba de 20261003200000_reparar_tabla_de_costos.sql con PostgreSQL embebido (PGlite): NO toca Supabase. En la tienda
// real ya existía una tabla product_costs con otras columnas cuando se corrió el script del 30-sep (que solo la crea si
// no existe). Se prueban varias formas de esa tabla vieja: el panel y el archivo privado de costos tienen que poder
// guardar, nada se pierde (queda una copia), solo el administrador la ve, y repetirlo no cambia nada.
//   node scripts/test-reparar-costos-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const [repair, sep30] = await Promise.all(['supabase/migrations/20261003200000_reparar_tabla_de_costos.sql',
  'supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql'].map(f => readFile(f, 'utf8')));

// ---------------------------------------------------------------- El archivo
{
  const code = repair.replace(/--[^\n]*/g, '');
  assert(/^-- REPARAR LA TABLA DE COSTOS/.test(repair) && /-- FIN\s*$/.test(repair), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios (se puede correr desde GitHub)');
  assert(code.indexOf('lock table public.product_costs in access exclusive mode nowait') < code.indexOf('alter table public.product_costs add column'), 'Aparta la tabla antes del primer cambio');
  assert(code.indexOf('create table private.product_costs_antes_20261003 as table public.product_costs') < code.indexOf('alter table public.product_costs add column'), 'Guarda la copia antes de cambiar nada');
  assert(/notify pgrst, 'reload schema'/.test(code), 'Avisa a la API de Supabase');
  assert(!/insert into public\.product_costs/i.test(code) && !/pricing/.test(code), 'El archivo público no trae costos ni la fórmula');
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', CLIENTE = '11111111-1111-1111-1111-111111111111';
const run = async db => (await db.exec(repair)).at(-1).rows;
const estado = (rows, cambio) => (rows.find(r => r.cambio === cambio) || {}).estado;
const costos = async db => (await db.query('select product_id, costs from public.product_costs order by product_id')).rows.map(r => [Number(r.product_id), r.costs.map(Number)]);
const as = async (db, id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id || '']);
async function conTablaVieja(sql) {
  const db = await nuevaBase(PGlite);
  await db.exec(`insert into public.admin_users values ('${ADMIN}');`);
  if (sql) await db.exec(sql);
  await db.exec(sep30); // como en la tienda real: el 30-sep no cambia una tabla que ya existe
  return db;
}
// Lo que hacen el panel (guardar un costo) y el archivo privado (cargar los de La Grada) después de reparar.
async function panelYArchivo(db) {
  await as(db, ADMIN); await db.exec('set role authenticated');
  await db.query(`insert into public.product_costs (product_id, costs, strategy, competitor_price) values (9, '{1750}', 'gancho', 3200)
    on conflict (product_id) do update set costs = excluded.costs, strategy = excluded.strategy, competitor_price = excluded.competitor_price`);
  await db.exec('reset role'); await as(db, '');
  await db.query(`insert into public.product_costs (product_id, costs, strategy, competitor_price, supplier, updated_at)
    values (10, '{2650, 3400}', 'normal', null, 'La Grada', now()) on conflict (product_id) do nothing`);
  await throws(() => db.query(`insert into public.product_costs (product_id, costs) values (11, '{0}')`), /check/i, 'Un costo en 0 no se guarda');
  await throws(() => db.query(`insert into public.product_costs (product_id, costs, strategy) values (11, '{100}', 'regalo')`), /check/i, 'Estrategia no válida');
}
async function soloAdministrador(db) {
  await db.exec('set role anon');
  await throws(() => db.query('select * from public.product_costs'), /permission denied/i, 'Un visitante no ve costos');
  await db.exec('reset role'); await as(db, CLIENTE); await db.exec('set role authenticated');
  assert.equal((await db.query('select * from public.product_costs')).rows.length, 0, 'Un cliente con cuenta no ve costos');
  await throws(() => db.query(`insert into public.product_costs (product_id, costs) values (12, '{100}')`), /row-level security/i, 'Ni los escribe');
  await db.exec('reset role'); await as(db, ADMIN); await db.exec('set role authenticated');
  assert((await db.query('select * from public.product_costs')).rows.length > 0, 'El administrador sí');
  await db.exec('reset role'); await as(db, '');
}

// ---------------------------------------------------------------- 1. Tabla vieja: costo en otra columna y una política que dejaba verla a cualquier cliente
{
  const db = await conTablaVieja(`create table public.product_costs (product_id bigint primary key references public.products (id), cost_price numeric(10,2) not null, updated_at timestamptz default now());
    alter table public.product_costs enable row level security;
    create policy "Cualquiera con cuenta" on public.product_costs for select to authenticated using (true);
    insert into public.product_costs (product_id, cost_price) values (1, 1500), (2, 0), (3, 2850.55);`);
  assert.equal((await one(db, `select count(*)::int as n from information_schema.columns where table_name = 'product_costs' and column_name = 'strategy'`)).n, 0, 'Así quedó en la tienda: sin las columnas del panel');
  const rows = await run(db);
  assert.equal(estado(rows, 'Copia de la tabla anterior'), 'guardada: private.product_costs_antes_20261003 (3 renglones)');
  assert.equal(estado(rows, 'Costo pasado de la tabla vieja'), '2 renglones (de la columna «cost_price»)');
  assert.equal(estado(rows, 'Renglones sin costo, sin perfume o repetidos'), '1 quitados (siguen en la copia)');
  assert.equal(estado(rows, 'Columnas viejas que quedaron (ya no obligatorias)'), 'cost_price');
  assert.equal(estado(rows, 'Quién la puede ver'), 'solo el administrador');
  assert.deepEqual(await costos(db), [[1, [1500]], [3, [2850.55]]], 'El costo viejo pasa a la columna nueva');
  await panelYArchivo(db);
  assert.deepEqual(await costos(db), [[1, [1500]], [3, [2850.55]], [9, [1750]], [10, [2650, 3400]]], 'El panel y el archivo privado guardan');
  await soloAdministrador(db);
  assert.equal((await one(db, `select count(*)::int as n from pg_policies where tablename = 'product_costs'`)).n, 1, 'La política vieja ya no está');
  const otra = await run(db);
  assert.equal(estado(otra, 'Copia de la tabla anterior'), 'ya estaba guardada: private.product_costs_antes_20261003 (3 renglones)', 'Repetirlo no pisa la copia');
  assert.deepEqual(await costos(db), [[1, [1500]], [3, [2850.55]], [9, [1750]], [10, [2650, 3400]]], 'ni cambia los costos');
  await db.close();
  console.log('tabla vieja con otra columna de costo y política abierta: reparada OK');
}
// ---------------------------------------------------------------- 2. Número de renglón como llave, repetidos, huérfanos y columnas obligatorias
{
  const db = await conTablaVieja(`create table public.product_costs (id serial primary key, product_id bigint, costo numeric not null, notas text not null, updated_at timestamptz);
    insert into public.product_costs (product_id, costo, notas, updated_at) values (5, 1000, 'vieja', null), (5, 1100, 'nueva', now()), (6, 900, 'x', null), (999999, 500, 'huérfano', null), (null, 300, 'sin perfume', null);`);
  const rows = await run(db);
  assert.equal(estado(rows, 'Costo pasado de la tabla vieja'), '5 renglones (de la columna «costo»)');
  assert.equal(estado(rows, 'Renglones sin costo, sin perfume o repetidos'), '3 quitados (siguen en la copia)');
  assert.deepEqual(await costos(db), [[5, [1100]], [6, [900]]], 'De los repetidos queda el más reciente');
  assert.equal((await one(db, `select count(*)::int as n from pg_constraint where conrelid = 'public.product_costs'::regclass and contype = 'p' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.product_costs'::regclass and attname = 'product_id')]`)).n, 1, 'La llave es el número de perfume');
  await panelYArchivo(db);
  await soloAdministrador(db);
  assert.equal((await one(db, 'select count(*)::int as n from private.product_costs_antes_20261003')).n, 5, 'La copia tiene todo lo de antes');
  await db.close();
  console.log('tabla vieja con número de renglón, repetidos y huérfanos: reparada OK');
}
// ---------------------------------------------------------------- 3. Tabla correcta (creada por el 30-sep): nada cambia
{
  const db = await conTablaVieja(null);
  await db.exec(`insert into public.product_costs (product_id, costs, strategy, competitor_price) values (1, '{1750}', 'gancho', 2900), (2, '{2850, 3400}', 'normal', null)`);
  const rows = await run(db);
  assert.equal(estado(rows, 'Costo pasado de la tabla vieja'), 'no había una columna de costo');
  assert.equal(estado(rows, 'Renglones sin costo, sin perfume o repetidos'), 'ninguno');
  assert.equal(estado(rows, 'Columnas viejas que quedaron (ya no obligatorias)'), 'ninguna');
  assert.equal(estado(rows, 'Columnas de la tabla de costos'), 'product_id, costs, strategy, competitor_price, supplier, updated_at');
  assert.deepEqual(await costos(db), [[1, [1750]], [2, [2850, 3400]]], 'Los costos no cambian');
  await panelYArchivo(db);
  await soloAdministrador(db);
  await db.close();
  console.log('tabla correcta: sin cambios OK');
}
// ---------------------------------------------------------------- 4. Dos columnas de números: no se adivina cuál es el costo
{
  const db = await conTablaVieja(`create table public.product_costs (product_id bigint primary key, costo numeric, precio numeric); insert into public.product_costs values (1, 100, 200);`);
  const rows = await run(db);
  assert.equal(estado(rows, 'Costo pasado de la tabla vieja'), 'no: había varias columnas de números (costo, precio); están en la copia');
  assert.deepEqual(await costos(db), [], 'No se inventa un costo');
  assert.equal((await one(db, 'select count(*)::int as n from private.product_costs_antes_20261003')).n, 1, 'pero queda en la copia');
  await panelYArchivo(db);
  await db.close();
  console.log('columnas ambiguas: no se adivina OK');
}
// ---------------------------------------------------------------- 5. Número de perfume guardado como texto y costos en lista
{
  const db = await conTablaVieja(`create table public.product_costs (product_id text primary key, costos numeric[]); insert into public.product_costs values ('1', '{1500}'), ('#2', '{1600, 2100}'), ('3', '{0}');`);
  const rows = await run(db);
  assert.equal(estado(rows, 'Costo pasado de la tabla vieja'), '2 renglones (de la columna «costos»)');
  assert.deepEqual(await costos(db), [[1, [1500]], [2, [1600, 2100]]], 'Número como texto y lista de costos');
  assert.equal((await one(db, `select data_type from information_schema.columns where table_name = 'product_costs' and column_name = 'product_id'`)).data_type, 'bigint');
  await panelYArchivo(db);
  await db.close();
  console.log('número como texto y lista de costos OK');
}
// ---------------------------------------------------------------- Sin tabla y pegado incompleto
{
  const db = await nuevaBase(PGlite);
  await throws(() => db.exec(repair), /corre primero el script «FUNCIONES NUEVAS Y PERFUMES NUEVOS»/, 'Sin la tabla de costos, mensaje claro');
  await db.close();
  const otra = await conTablaVieja(`create table public.product_costs (product_id bigint primary key, cost_price numeric); insert into public.product_costs values (1, 100);`);
  await throws(() => otra.exec(repair.slice(0, Math.floor(repair.length * 0.55))), /./, 'Un pegado incompleto da error');
  assert.equal((await one(otra, `select count(*)::int as n from information_schema.columns where table_name = 'product_costs' and column_name = 'strategy'`)).n, 0, 'y no deja nada a medias');
  assert.equal((await one(otra, `select to_regclass('private.product_costs_antes_20261003') as t`)).t, null);
  await otra.close();
  console.log('sin tabla y pegado incompleto OK');
}
console.log('TODAS LAS PRUEBAS DE LA REPARACIÓN DE LA TABLA DE COSTOS PASARON');
