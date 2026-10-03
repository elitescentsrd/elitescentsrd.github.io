// Prueba de la migración 20260930120000_funciones_y_perfumes_nuevos.sql con PostgreSQL embebido (PGlite): NO toca Supabase
// ni necesita claves. Aplica las migraciones anteriores sobre un esquema mínimo que imita Supabase y comprueba:
// perfumes nuevos (números fijos, «Solo por encargo» desde RD$7,000, repetir sin duplicar, choque de números y deshacer),
// «Inspirado en…», «Avísame cuando llegue» (validación, límites y permisos), «Lo más vendido» (solo números de perfume),
// abonos y costos privados (solo administradores) y que un pegado incompleto no cambia nada.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-funciones-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const MIGRACION = 'supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql';
const [migration, ofertas, cupones, proteccion, encuesta, nuevosText, inspiradoText] = await Promise.all([
  MIGRACION, 'supabase/migrations/20260921121000_ofertas.sql', 'supabase/migrations/20260921130000_cupones.sql',
  'supabase/migrations/20260922120000_proteccion_pedidos.sql', 'supabase/migrations/20260923120000_encuesta.sql',
  'data/perfumes-nuevos-2026-09.json', 'data/inspirado-en.json',
].map(f => readFile(f, 'utf8')));
const nuevos = JSON.parse(nuevosText), inspirado = JSON.parse(inspiradoText);
const idsNuevos = Object.keys(nuevos.perfumes).map(Number);

// El archivo es público (GitHub): nunca trae costos ni la fórmula de precios.
{
  const code = migration.replace(/--[^\n]*/g, '');
  assert(!/insert\s+into\s+public\.product_costs/i.test(code), 'La migración no carga costos');
  assert(!/pricing\s*=|'\{"/i.test(code), 'La migración no carga la fórmula de precios');
  assert(/^-- FUNCIONES NUEVAS Y PERFUMES NUEVOS/.test(migration) && /-- FIN\s*$/.test(migration), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(/create temp table modo on commit drop as select false as deshacer;/.test(migration), 'Queda en modo aplicar');
  // Supabase devolvió «deadlock detected» con un cliente comprando a la vez (lee ajustes y luego perfumes): el script
  // aparta todo lo que va a cambiar al principio, sin esperar con algo apartado (NOWAIT y reintentos).
  const turno = code.indexOf('lock table public.products, public.store_settings in access exclusive mode nowait');
  assert(turno > 0 && turno < code.indexOf('alter table public.products add column'), 'Aparta perfumes y ajustes antes del primer cambio');
  assert(/lock table public\.orders in share row exclusive mode nowait/.test(code) && /exception when lock_not_available then\s+perform pg_sleep/.test(code), 'Pedidos también, y si están ocupados suelta todo y reintenta');
}

async function nuevaBase() {
  const db = new PGlite();
  await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema private;
grant usage on schema private to authenticated;
create table public.admin_users (user_id uuid primary key);
create table public.customer_profiles (user_id uuid primary key, first_name text, last_name text, cedula text, phone text, address text);
create function private.is_store_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;
grant execute on function private.is_store_admin() to authenticated;
create table public.products (
  id bigint generated always as identity primary key, name text not null, price text not null default 'Precio a confirmar',
  size text not null default '' check (length(size) <= 60), gender text not null default 'unisex' check (gender in ('hombre','mujer','unisex')),
  page integer, slot integer, image_url text, sort_order integer not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  availability text not null default 'disponible' check (availability in ('disponible','agotado','encargo')),
  brand text not null default '', notes_top text[] not null default '{}', notes_heart text[] not null default '{}', notes_base text[] not null default '{}',
  gallery_urls text[] not null default '{}', description text not null default '',
  constraint products_notes_top_limit check (cardinality(notes_top) <= 12), constraint products_notes_heart_limit check (cardinality(notes_heart) <= 12),
  constraint products_notes_base_limit check (cardinality(notes_base) <= 12), constraint products_description_length check (length(description) <= 1200));
alter table public.products enable row level security;
grant select on public.products to anon; grant select, insert, update, delete on public.products to authenticated;
create policy "Read active catalogue" on public.products for select to anon using (active);
create policy "Admins read catalogue" on public.products for select to authenticated using ((select private.is_store_admin()));
create table public.orders (id bigint generated always as identity primary key, created_at timestamptz not null default now(), customer_name text, phone text,
  items text, amount text not null default '', status text not null default 'nuevo', notes text, user_id uuid, cedula text);
alter table public.orders enable row level security;
grant select, insert, update, delete on public.orders to authenticated;
create policy "Admins read orders" on public.orders for select to authenticated using ((select private.is_store_admin()));
create function public.place_customer_order(p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ begin return '{}'::jsonb; end $$;
revoke execute on function public.place_customer_order(jsonb) from public, anon;
-- Regla de siempre: RD$7,000 o más = «Solo por encargo» (salvo «Agotado»).
create function private.enforce_high_price_by_order() returns trigger language plpgsql set search_path = '' as $$
declare highest numeric;
begin
  select max(replace(replace(m[1], ',', ''), '.', '')::numeric) into highest from regexp_matches(new.price, '([0-9][0-9,.]*)', 'g') as m;
  if highest >= 7000 and new.availability is distinct from 'agotado' then new.availability := 'encargo'; end if;
  return new;
end $$;
create trigger products_high_price_by_order before insert or update of price, availability on public.products for each row execute function private.enforce_high_price_by_order();
-- La tienda de hoy: 420 perfumes (3 French Avenue con la marca incompleta).
insert into public.products (name, price, brand, sort_order, availability)
  select 'Perfume ' || g, 'RD$' || to_char(2000 + g * 10, 'FM999,999'), 'Marca', g - 1, case when g % 5 = 0 then 'agotado' else 'disponible' end from generate_series(1, 420) g;
update public.products set name = 'French Avenue Aether Extrait', brand = 'French' where id = 152;
update public.products set name = 'French Avenue Atlantis Extrait', brand = 'French' where id = 153;
update public.products set name = 'French Avenue Liquid Brun', brand = 'French' where id = 156;
update public.products set price = 'RD$7,500' where id in (7, 8);
`);
  for (const sql of [ofertas, cupones, proteccion, encuesta]) await db.exec(sql);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const aplicar = async (db, sql = migration) => (await db.exec(sql)).at(-1).rows;
const fila = (rows, texto) => rows.find(r => r.cambio.includes(texto));
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };

// ---------------------------------------------------------------- Aplicar, repetir y deshacer
const db = await nuevaBase();
let res = await aplicar(db);
assert.equal(Number(fila(res, 'agregados').hechos_ahora), idsNuevos.length, 'Se agregan los perfumes nuevos');
assert.equal(Number(fila(res, 'Inspirado').hechos_ahora), Object.keys(inspirado.perfumes).filter(id => Number(id) <= 420).length, 'Se escriben las referencias «Inspirado en»');
assert.equal(Number(fila(res, 'French Avenue').hechos_ahora), 3, 'Se completa la marca French Avenue');
const filas = (await db.query('select * from public.products where id between $1 and $2 order by id', [nuevos.primer_id, nuevos.ultimo_id])).rows;
assert.equal(filas.length, idsNuevos.length);
for (const p of filas) {
  const esperado = nuevos.perfumes[String(p.id)];
  assert.equal(p.name, esperado.name); assert.equal(p.price, esperado.price); assert.equal(p.brand, esperado.brand); assert.equal(p.size, esperado.size);
  assert.equal(p.gender, esperado.gender); assert.equal(p.active, true); assert.equal(p.page, null, 'Sin posición de láminas');
  const max = Math.max(...esperado.price.match(/[0-9][0-9,]*/g).map(v => Number(v.replace(/,/g, ''))));
  assert.equal(p.availability, max >= 7000 ? 'encargo' : 'disponible', 'Disponibilidad de ' + p.name);
  assert.equal(nuevos.notas_pendientes.includes(Number(p.id)), p.notes_top.length === 0, 'Notas de ' + p.name);
}
assert((await one(db, `select count(*)::int as n from public.products where id >= 421 and availability = 'encargo'`)).n >= 10, 'Los caros quedan por encargo');
for (const [id, { referencia }] of Object.entries(inspirado.perfumes)) assert.equal((await one(db, 'select inspired_by from public.products where id = $1', [id])).inspired_by, referencia, 'Inspirado en de #' + id);
await db.exec(`insert into public.products (name, price) values ('Creado en el panel', 'RD$3,000')`);
assert.equal(Number((await one(db, `select id from public.products where name = 'Creado en el panel'`)).id), nuevos.ultimo_id + 1, 'El panel sigue numerando después del último');
await db.exec(`delete from public.products where name = 'Creado en el panel'`);

res = await aplicar(db);
assert.equal(Number(fila(res, 'agregados').hechos_ahora), 0, 'Repetirlo no duplica');
assert.equal(Number(fila(res, 'agregados').ya_estaban), idsNuevos.length);
assert.equal(Number(fila(res, 'Inspirado').hechos_ahora), 0); assert.equal(Number(fila(res, 'French Avenue').hechos_ahora), 0);
assert.equal((await one(db, 'select count(*)::int as n from public.products')).n, 420 + idsNuevos.length);
// Lo que el dueño cambia en el panel se respeta al repetir el script.
await db.exec(`update public.products set inspired_by = 'Mi referencia' where id = 50`);
res = await aplicar(db);
assert.equal((await one(db, 'select inspired_by from public.products where id = 50')).inspired_by, 'Mi referencia');
assert.equal(Number(fila(res, 'Inspirado').total) - Number(fila(res, 'Inspirado').hechos_ahora) - Number(fila(res, 'Inspirado').ya_estaban), 1, 'Aparece como sin cambiar');
console.log('perfumes nuevos, «Inspirado en» y marca: aplicar y repetir OK');

res = await aplicar(db, migration.replace('select false as deshacer;', 'select true as deshacer;'));
assert.equal(Number(fila(res, 'quitados').hechos_ahora), idsNuevos.length, 'Deshacer quita los nuevos');
assert.equal((await one(db, 'select count(*)::int as n from public.products')).n, 420);
assert.equal((await one(db, `select count(*)::int as n from public.products where inspired_by is not null`)).n, 1, 'Deshacer quita las referencias del script (y deja la escrita a mano)');
assert.equal((await one(db, `select count(*)::int as n from public.products where brand = 'French'`)).n, 3, 'Deshacer devuelve la marca');
await db.exec(`insert into public.products (name, price) values ('Después de deshacer', 'RD$3,000')`);
assert.equal(Number((await one(db, `select id from public.products where name = 'Después de deshacer'`)).id), 421, 'Tras deshacer, el panel vuelve a numerar desde 421');
await db.exec(`delete from public.products where name = 'Después de deshacer'`);
res = await aplicar(db);
assert.equal(Number(fila(res, 'agregados').hechos_ahora), idsNuevos.length, 'Se puede volver a aplicar después de deshacer');
console.log('deshacer y volver a aplicar OK');

// ---------------------------------------------------------------- Choque de números y pegado incompleto
{
  const otra = await nuevaBase();
  await otra.exec(`insert into public.products (name, price) values ('Perfume creado en el panel', 'RD$2,500')`);
  await throws(() => aplicar(otra), /ya están ocupados/, 'Si el número 421 ya es otro perfume, se detiene');
  assert.equal((await one(otra, 'select count(*)::int as n from public.products')).n, 421, 'y no cambia nada');
  assert.equal((await one(otra, `select to_regclass('public.restock_alerts') as t`)).t, null, 'ni crea tablas');
  const recortado = migration.slice(0, Math.floor(migration.length * 0.62));
  await throws(() => otra.exec(recortado), /./, 'Un pegado incompleto da error');
  assert.equal((await one(otra, `select to_regclass('public.order_payments') as t`)).t, null, 'y no deja nada a medias');
  await otra.close();
}
console.log('choque de números y pegado incompleto: no cambian nada OK');

// ---------------------------------------------------------------- «Avísame cuando llegue»
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', U1 = '11111111-1111-1111-1111-111111111111';
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}','a@x.com'),('${U1}','u1@x.com'); insert into public.admin_users values ('${ADMIN}')`);
const as = async id => { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id || '']); };
const headers = async h => { await db.query(`select set_config('request.headers', $1, false)`, [h ? JSON.stringify(h) : '']); };
const avisar = async (id, nombre, tel) => (await one(db, 'select public.request_restock_alert($1, $2, $3) as r', [id, nombre, tel])).r;
const AGOTADO = 5, DISPONIBLE = 1, ENCARGO = (await one(db, `select id from public.products where availability = 'encargo' order by id limit 1`)).id;
await db.exec('set role anon');
let r = await avisar(AGOTADO, 'Ana Pérez', '(809) 555-1234');
assert.equal(r.ok, true); assert.equal(r.already, false); assert.match(r.message, /te escribiremos/);
r = await avisar(AGOTADO, 'Ana', '1-809-555-1234'); assert.equal(r.ok, true); assert.equal(r.already, true, 'El mismo número no se anota dos veces');
r = await avisar(ENCARGO, 'Ana', '8095551234'); assert.equal(r.ok, true, 'También para perfumes por encargo');
r = await avisar(DISPONIBLE, 'Ana', '8095551234'); assert.equal(r.ok, false); assert.match(r.message, /ya está disponible/);
r = await avisar(AGOTADO, 'A', '8095551234'); assert.equal(r.ok, false); assert.match(r.message, /nombre/);
r = await avisar(AGOTADO, '<script>', '8095551234'); assert.equal(r.ok, false, 'Sin etiquetas en el nombre');
r = await avisar(AGOTADO, 'Luis', '555-1234'); assert.equal(r.ok, false); assert.match(r.message, /10 dígitos/);
r = await avisar(AGOTADO, 'Luis', '+34 612 345 678'); assert.equal(r.ok, false, 'Solo números dominicanos (809, 829 u 849)');
r = await avisar(999999, 'Luis', '8295550000'); assert.equal(r.ok, false); assert.match(r.message, /ya no está/);
await throws(() => db.query('select * from public.restock_alerts'), /permission denied/i, 'Un visitante no lee la lista');
await throws(() => db.query(`insert into public.restock_alerts (product_id, customer_name, phone) values (5, 'X', '8095550000')`), /permission denied/i, 'Ni se anota saltándose la función');
await db.exec('reset role');
assert.equal((await one(db, 'select phone from public.restock_alerts limit 1')).phone, '8095551234', 'El teléfono se guarda con 10 dígitos');
// Límite por conexión: 5 por hora.
await headers({ 'cf-connecting-ip': '200.1.2.3' }); await db.exec('set role anon');
for (let i = 0; i < 5; i++) { r = await avisar(AGOTADO, 'Persona ' + i, '82955500' + String(10 + i)); assert.equal(r.ok, true); }
r = await avisar(AGOTADO, 'Persona 6', '8495550099'); assert.equal(r.ok, false); assert.match(r.message, /varias solicitudes/, 'El sexto aviso en una hora desde la misma conexión se frena');
await db.exec('reset role'); await headers({ 'cf-connecting-ip': '200.9.9.9' }); await db.exec('set role anon');
r = await avisar(AGOTADO, 'Persona 6', '8495550099'); assert.equal(r.ok, true, 'Desde otra conexión sí');
await db.exec('reset role'); await headers(null);
// Límite por número: 10 pendientes.
const agotados = (await db.query(`select id from public.products where availability = 'agotado' order by id limit 12`)).rows.map(x => x.id);
await db.exec('set role anon');
for (const id of agotados.slice(0, 9)) { r = await avisar(id, 'Mario', '8095557777'); assert.equal(r.ok, true); }
r = await avisar(agotados[9], 'Mario', '8095557777'); assert.equal(r.ok, true, 'El décimo pendiente se anota');
r = await avisar(agotados[10], 'Mario', '8095557777'); assert.equal(r.ok, false); assert.match(r.message, /10 avisos/);
await db.exec('reset role');
// Permisos: un cliente no ve la lista; el administrador la ve, marca «avisado» y borra.
await as(U1); await db.exec('set role authenticated');
assert.equal((await db.query('select * from public.restock_alerts')).rows.length, 0, 'Un cliente no ve la lista');
assert.equal((await db.query(`update public.restock_alerts set status = 'avisado'`)).affectedRows, 0, 'Ni la cambia');
await db.exec('reset role'); await as(ADMIN); await db.exec('set role authenticated');
const total = (await db.query('select * from public.restock_alerts')).rows.length;
assert(total >= 17, 'El administrador ve la lista');
assert.equal((await db.query(`update public.restock_alerts set status = 'avisado', notified_at = now() where phone = '8095551234'`)).affectedRows, 2);
await throws(() => db.query(`update public.restock_alerts set phone = '8090000000'`), /permission denied/i, 'El administrador solo cambia el estado');
assert.equal((await db.query(`delete from public.restock_alerts where phone = '8095557777'`)).affectedRows, 10);
await db.exec('reset role'); await as('');
await db.exec('set role anon'); r = await avisar(AGOTADO, 'Ana', '8095551234'); await db.exec('reset role');
assert.equal(r.already, false, 'Después de avisado, la misma persona puede volver a anotarse');
// Limpieza automática: avisados de más de 90 días y cualquiera de más de 180 días.
await db.exec(`update public.restock_alerts set notified_at = now() - interval '91 days' where status = 'avisado'`);
await db.exec(`update public.restock_alerts set created_at = now() - interval '181 days' where customer_name = 'Persona 0'`);
await db.exec('set role anon'); await avisar(ENCARGO, 'Nueva', '8295559999'); await db.exec('reset role');
assert.equal((await one(db, `select count(*)::int as n from public.restock_alerts where status = 'avisado' or customer_name = 'Persona 0'`)).n, 0, 'Se borran los viejos');
console.log('«Avísame cuando llegue»: validación, límites, permisos y limpieza OK');

// ---------------------------------------------------------------- «Lo más vendido»
await db.exec(`insert into public.orders (customer_name, phone, items, amount, status) values
  ('A', '809', E'2x Perfume 10 (100 ML)\\n1x Perfume 20', 'RD$6,000', 'confirmado'),
  ('B', '809', '3 x Perfume 30', 'RD$6,000', 'entregado'),
  ('C', '809', E'1x Perfume 20 (100 ML)\\r\\n1x Perfume 10', 'RD$4,000', 'enviado'),
  ('D', '809', '9x Perfume 40', 'RD$9,000', 'cancelado'),
  ('E', '809', '8x Perfume 41', 'RD$9,000', 'nuevo'),
  ('F', '809', 'perfume 30; Perfume 11', 'RD$4,000', 'preparando')`);
await db.exec(`insert into public.orders (customer_name, phone, items, amount, status, created_at) values ('G', '809', '9x Perfume 50', 'RD$9,000', 'entregado', now() - interval '200 days')`);
await db.exec('set role anon');
const top = (await db.query('select * from public.best_sellers()')).rows;
assert.deepEqual(Object.keys(top[0]), ['product_id'], 'Solo devuelve números de perfume');
assert.deepEqual(top.map(x => Number(x.product_id)), [30, 10, 20, 11], 'Ordena por unidades vendidas (confirmadas, sin canceladas ni nuevas, últimos 120 días)');
assert.deepEqual((await db.query('select * from public.best_sellers(365, 2)')).rows.map(x => Number(x.product_id)), [50, 30], 'Respeta días y límite');
await db.exec('reset role');
await db.exec(`update public.products set active = false where id = 10`);
await db.exec('set role anon');
assert(!(await db.query('select * from public.best_sellers()')).rows.some(x => Number(x.product_id) === 10), 'No muestra perfumes ocultos');
await db.exec('reset role');
await db.exec(`update public.products set active = true where id = 10`);
console.log('«Lo más vendido» OK');

// ---------------------------------------------------------------- Abonos y costos privados
const pedido = (await one(db, `select id from public.orders where customer_name = 'A'`)).id;
await db.exec('set role anon');
await throws(() => db.query('select * from public.order_payments'), /permission denied/i, 'Un visitante no ve abonos');
await throws(() => db.query('select * from public.product_costs'), /permission denied/i, 'Un visitante no ve costos');
await throws(() => db.query('select pricing from public.store_settings'), /permission denied/i, 'Ni la fórmula de precios');
await db.exec('reset role'); await as(U1); await db.exec('set role authenticated');
assert.equal((await db.query('select * from public.product_costs')).rows.length, 0);
await throws(() => db.query(`insert into public.product_costs (product_id, costs) values (1, '{1500}')`), /row-level security/i, 'Un cliente no escribe costos');
await throws(() => db.query(`insert into public.order_payments (order_id, amount) values (${pedido}, 100)`), /row-level security/i, 'Un cliente no registra abonos');
await db.exec('reset role'); await as(ADMIN); await db.exec('set role authenticated');
await db.query(`insert into public.order_payments (order_id, amount, method, note) values (${pedido}, 1000, 'transferencia', 'Primer abono'), (${pedido}, 500, 'efectivo', '')`);
assert.equal(Number((await one(db, `select sum(amount) as s from public.order_payments where order_id = ${pedido}`)).s), 1500);
await throws(() => db.query(`insert into public.order_payments (order_id, amount) values (${pedido}, 0)`), /check/i, 'Un abono de 0 no se guarda');
await throws(() => db.query(`insert into public.order_payments (order_id, amount, method) values (${pedido}, 10, 'bitcoin')`), /check/i, 'Método no válido');
await db.query(`insert into public.product_costs (product_id, costs, strategy) values (1, '{1750}', 'gancho'), (2, '{2850,3400}', 'normal')`);
await throws(() => db.query(`insert into public.product_costs (product_id, costs) values (3, '{0}')`), /check/i, 'Costo en 0 no');
await throws(() => db.query(`insert into public.product_costs (product_id, costs, strategy) values (4, '{100}', 'regalo')`), /check/i, 'Estrategia no válida');
assert.equal((await db.query(`update public.store_settings set pricing = '{"logistica":200}'::jsonb`)).affectedRows, 1, 'El administrador guarda la fórmula');
assert.equal((await db.query('select * from public.product_costs')).rows.length, 2, 'El administrador lee los costos');
await db.exec('reset role');
await db.exec(`delete from public.orders where id = ${pedido}`);
assert.equal((await one(db, `select count(*)::int as n from public.order_payments where order_id = ${pedido}`)).n, 0, 'Al borrar el pedido se borran sus abonos');
await db.exec(`delete from public.products where id = 1`);
assert.equal((await one(db, 'select count(*)::int as n from public.product_costs where product_id = 1')).n, 0, 'Al borrar el perfume se borra su costo');
await throws(() => db.exec(`update public.products set inspired_by = 'x' where id = 2`), /products_inspired_by_length/, '«Inspirado en» de al menos 2 letras');
console.log('abonos, costos privados y fórmula: solo administradores OK');

// ---------------------------------------------------------------- Estadísticas y publicación automática (3-oct)
{
  const estad = await readFile('supabase/migrations/20261003120000_estadisticas_y_publicacion.sql', 'utf8');
  assert(/^-- ESTADÍSTICAS Y PUBLICACIÓN AUTOMÁTICA/.test(estad) && /-- FIN\s*$/.test(estad) && /select false as deshacer;/.test(estad), 'Script de estadísticas completo y en modo aplicar');
  assert(!/github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}/.test(estad), 'El script público no trae ninguna clave de GitHub');
  // Supabase trae Vault y pg_net; aquí se imitan para comprobar el aviso a GitHub sin salir a internet.
  await db.exec(`create schema if not exists vault; create table vault.secrets_stub (name text, secret text);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_stub;
    create schema if not exists net; create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
      returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;`);
  await as(''); await db.exec('reset role');
  let estado = (await db.exec(estad)).at(-1).rows;
  assert.deepEqual(estado.map(r => r.estado), ['listas', 'lista: falta guardar la clave de GitHub (si ya la guardaste, está activa)'], 'Resumen al aplicar');
  const llamadas = async () => (await one(db, 'select count(*)::int as n from net.calls')).n;
  const evento = async (...args) => { await db.query('select public.track_event($1, $2, $3, $4, $5)', [...args, null, null, null, null, null].slice(0, 5)); };
  const eventos = async (where = 'true') => (await one(db, 'select count(*)::int as n from public.site_events where ' + where)).n;

  // Un visitante (anon) registra eventos, pero nunca lee la tabla.
  await headers({ 'x-forwarded-for': '10.0.0.1' });
  await db.exec('set role anon');
  await evento('visita', null, null, 'Instagram.com', 'movil');
  await evento('perfume', 2); await evento('perfume', 999999); await evento('whatsapp', 2); await evento('carrito', 2);
  await evento('busqueda', null, '  Aventus   Creed '); await evento('sin_resultado', null, 'Baccarat 540');
  await evento('busqueda', null, 'ana@correo.com'); await evento('busqueda', null, '8095551234'); await evento('sin_resultado', null, 'x');
  await evento('hackeo'); await evento('visita', null, null, null, 'tableta');
  await throws(() => db.query('select * from public.site_events'), /permission denied/i, 'Un visitante no lee las estadísticas');
  await throws(() => db.query('select public.admin_site_stats(30)'), /permission denied/i, 'Ni el resumen');
  await db.exec('reset role');
  assert.equal(await eventos(), 7, 'Se guardan solo los eventos válidos (perfume inexistente, correo, teléfono, texto corto y tipo inventado no)');
  assert.equal(await eventos(`kind = 'busqueda' and term = 'aventus creed'`), 1, 'La búsqueda se guarda en minúsculas y sin espacios de más');
  assert.equal(await eventos(`term like '%@%' or term ~ '[0-9]{6,}'`), 0, 'Nunca correos ni números largos');
  assert.equal(await eventos(`kind = 'visita' and source = 'instagram.com' and device = 'movil'`), 1, 'Origen y aparato de la visita');
  assert.equal(await eventos(`kind = 'visita' and device is null`), 1, 'Un aparato desconocido no se guarda');
  assert.equal(await eventos('ip_hash is not null'), 7, 'Cada evento lleva la huella de conexión (para los límites)');
  // Límite: 120 eventos cada 10 minutos por conexión.
  await headers({ 'x-forwarded-for': '10.0.0.2' });
  for (let i = 0; i < 125; i++) await evento('visita');
  assert.equal(await eventos(`ip_hash = (select ip_hash from public.site_events order by id desc limit 1)`), 120, 'Una conexión no registra más de 120 eventos en 10 minutos');
  await headers(null);
  // Limpieza: huella a los 2 días y eventos a los 13 meses.
  await db.exec(`update public.site_events set created_at = now() - interval '3 days' where id in (select id from public.site_events order by id limit 5);
    insert into public.site_events (kind, created_at) values ('visita', now() - interval '401 days')`);
  for (let i = 0; i < 400 && (await eventos(`created_at < now() - interval '400 days'`)); i++) await evento('visita');
  assert.equal(await eventos(`created_at < now() - interval '400 days'`), 0, 'Se borran los eventos de más de 13 meses');
  assert.equal(await eventos(`ip_hash is not null and created_at < now() - interval '2 days'`), 0, 'Se borra la huella de más de 2 días');

  // Resumen: solo administradores.
  await as(U1); await db.exec('set role authenticated');
  await throws(() => db.query('select public.admin_site_stats(30)'), /Solo para administradores/, 'Un cliente no ve el resumen');
  await db.exec('reset role'); await as(ADMIN); await db.exec('set role authenticated');
  const stats = (await one(db, 'select public.admin_site_stats(30) as s')).s;
  await db.exec('reset role'); await as('');
  assert(stats.totales.visitas >= 121 && stats.totales.perfumes === 1 && stats.totales.whatsapp === 1 && stats.totales.carrito === 1 && stats.totales.sin_resultado === 1, 'Totales del resumen');
  assert.deepEqual(stats.sin_resultado, [{ texto: 'baccarat 540', veces: 1 }], 'Búsquedas sin resultado');
  assert(stats.perfumes[0].id === 2 && stats.perfumes[0].vistas === 1 && stats.perfumes[0].whatsapp === 1, 'Perfumes más vistos');
  assert(stats.origenes.some(o => o.origen === 'instagram.com') && stats.dispositivos.some(d => d.dispositivo === 'movil'), 'Orígenes y aparatos');

  // Publicación automática: sin clave no hace nada; con clave avisa a GitHub como máximo cada 30 segundos.
  await db.exec(`update public.products set price = price where id = 2`);
  assert.equal(await llamadas(), 0, 'Sin la clave de GitHub no se avisa');
  await db.exec(`insert into vault.secrets_stub values ('github_publish_token', 'tok-prueba')`);
  await db.exec(`update public.products set price = price where id = 2`);
  const call = await one(db, 'select * from net.calls order by id desc limit 1');
  assert(call && call.url === 'https://api.github.com/repos/elitescentsrd/elitescentsrd.github.io/dispatches' && call.headers.Authorization === 'Bearer tok-prueba' && call.body.event_type === 'catalogo', 'Aviso a GitHub con la clave y el evento «catalogo»');
  await db.exec(`update public.products set price = price where id in (2, 3)`); await db.exec(`insert into public.products (name, price) values ('Otro', 'RD$3,000')`);
  assert.equal(await llamadas(), 1, 'Varios cambios seguidos: un solo aviso');
  await db.exec(`update private.publish_state set last_request = now() - interval '31 seconds'`);
  await db.exec(`delete from public.products where name = 'Otro'`);
  assert.equal(await llamadas(), 2, 'Pasados 30 segundos, otro aviso');
  await db.exec(`create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$ begin raise exception 'sin internet'; end $$;
    update private.publish_state set last_request = null`);
  await db.exec(`update public.products set price = 'RD$9,999' where id = 2`);
  assert.equal((await one(db, 'select price from public.products where id = 2')).price, 'RD$9,999', 'Un error al avisar nunca impide guardar el perfume');

  // Repetir y deshacer.
  estado = (await db.exec(estad)).at(-1).rows;
  assert.equal(estado[0].estado, 'listas', 'Repetirlo no cambia nada');
  estado = (await db.exec(estad.replace('select false as deshacer;', 'select true as deshacer;'))).at(-1).rows;
  assert.deepEqual(estado.map(r => r.estado), ['quitadas', 'quitada'], 'Deshacer quita estadísticas y publicación');
  assert.equal((await one(db, `select count(*)::int as n from pg_trigger where tgname = 'products_request_publish'`)).n, 0);
  assert.equal((await one(db, `select to_regprocedure('public.track_event(text,bigint,text,text,text)') as f`)).f, null);
  estado = (await db.exec(estad)).at(-1).rows;
  assert.equal(estado[0].estado, 'listas', 'Se puede volver a aplicar');
  // Pegado incompleto: no cambia nada.
  const limpio = await nuevaBase(); await limpio.exec(migration);
  await throws(() => limpio.exec(estad.slice(0, Math.floor(estad.length * 0.5))), /./, 'Un pegado incompleto da error');
  assert.equal((await one(limpio, `select to_regclass('public.site_events') as t`)).t, null, 'y no deja nada a medias');
  await limpio.close();
  console.log('estadísticas (límites, privacidad, solo administradores) y publicación automática OK');
}
await db.close();
console.log('TODAS LAS PRUEBAS DE LA MIGRACIÓN DE FUNCIONES Y PERFUMES NUEVOS PASARON');
