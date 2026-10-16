// Prueba de 20261016120000_catalogo_la_grada_octubre.sql con PostgreSQL embebido (PGlite): NO toca Supabase ni necesita
// claves. Sobre la tienda de prueba con el script del 30 de septiembre ya aplicado comprueba: perfumes nuevos (números
// fijos, «Solo por encargo» desde RD$7,000, notas), precios que cambian por el costo nuevo (ofertas que terminan y el
// perfume agotado que vuelve), que un precio cambiado a mano en el panel no se toca y se avisa, repetir sin duplicar,
// deshacer (devuelve precios, ofertas y disponibilidad), choque de números, falta del script anterior y pegado incompleto.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-catalogo-octubre-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const DATOS = 'data/perfumes-nuevos-2026-10.json';
const datos = JSON.parse(await readFile(DATOS, 'utf8'));
const [script, sep30] = await Promise.all([datos.aplicar_con, 'supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql'].map(f => readFile(f, 'utf8')));
const nuevos = Object.entries(datos.perfumes).map(([id, p]) => ({ id: Number(id), ...p }));
const cambios = Object.entries(datos.precios).map(([id, c]) => ({ id: Number(id), ...c }));
const max = price => Math.max(...price.match(/[0-9][0-9,]*/g).map(v => Number(v.replace(/,/g, ''))));

// ---------------------------------------------------------------- El archivo (público: nunca costos ni la fórmula)
{
  const code = script.replace(/--[^\n]*/g, '');
  assert(/^-- CATÁLOGO DE LA GRADA DE OCTUBRE/.test(script) && /-- FIN\s*$/.test(script), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(/create temp table modo on commit drop as select false as deshacer;/.test(script), 'Queda en modo aplicar');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios (se puede correr desde GitHub)');
  assert(!/product_costs|pricing|costo/i.test(code), 'No trae costos ni la fórmula de precios');
  const turno = code.indexOf('lock table public.products in share row exclusive mode nowait');
  assert(turno > 0 && turno < code.indexOf('insert into public.products'), 'Aparta los perfumes antes del primer cambio');
  assert(/exception when lock_not_available then\s+perform pg_sleep/.test(code), 'Si están ocupados, suelta todo y reintenta');
  assert(!/costo|margen|ganancia|"cost/i.test(JSON.stringify({ perfumes: datos.perfumes, precios: datos.precios })), 'El archivo público de datos no tiene costos');
  assert.equal(Math.min(...nuevos.map(p => p.id)), datos.primer_id); assert.equal(Math.max(...nuevos.map(p => p.id)), datos.ultimo_id);
  assert.equal(datos.ultimo_id - datos.primer_id + 1, nuevos.length, 'Números seguidos');
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const aplicar = async (db, sql = script) => (await db.exec(sql)).at(-1).rows;
const fila = (rows, texto) => rows.find(r => r.cambio.includes(texto));
const avisos = rows => rows.filter(r => r.cambio.startsWith('No se tocó'));
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const DESHACER = script.replace('select false as deshacer;', 'select true as deshacer;');

// La tienda como está hoy: el script del 30 de septiembre aplicado y los perfumes que cambian con su nombre, su precio,
// su oferta y su disponibilidad de hoy (los de la tienda de prueba se llaman «Perfume N»).
async function base() {
  const db = await nuevaBase(PGlite);
  await db.exec(sep30);
  for (const c of cambios) {
    await db.query(`update public.products set name = $2, price = $3, original_price = $4, offer_label = case when $4::text is null then null else 'Precio especial' end,
      offer_ends_at = case when $4::text is null then null else '2026-10-31T23:59:00-04:00'::timestamptz end,
      availability = case when $5 then 'agotado' when availability = 'agotado' then 'disponible' else availability end where id = $1`,
      [c.id, c.nombre, c.antes, c.oferta_antes, c.reactivar]);
  }
  return db;
}
const estado = async (db, id) => one(db, 'select name, price, original_price, offer_label, offer_ends_at, availability from public.products where id = $1', [id]);

// ---------------------------------------------------------------- Aplicar y repetir
const db = await base();
const antes = Object.fromEntries(await Promise.all(cambios.map(async c => [c.id, await estado(db, c.id)])));
const totalAntes = (await one(db, 'select count(*)::int as n from public.products')).n;
let res = await aplicar(db);
assert.equal(Number(fila(res, 'agregados').hechos_ahora), nuevos.length, 'Se agregan los perfumes nuevos');
assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length, 'Se cambian los precios');
assert.deepEqual(avisos(res), [], 'Sin avisos cuando la tienda está como se esperaba');
assert.equal((await one(db, 'select count(*)::int as n from public.products')).n, totalAntes + nuevos.length);
for (const n of nuevos) {
  const p = await one(db, 'select * from public.products where id = $1', [n.id]);
  assert.equal(p.name, n.name); assert.equal(p.price, n.price); assert.equal(p.brand, n.brand); assert.equal(p.size, n.size); assert.equal(p.gender, n.gender);
  assert.equal(p.active, true); assert.equal(p.image_url, null, 'La foto sale de img/productos (por número)');
  assert.equal(p.availability, max(n.price) >= 7000 ? 'encargo' : 'disponible', 'Disponibilidad de ' + n.name);
  assert.equal(datos.notas_pendientes.includes(n.id), p.notes_top.length === 0, 'Notas de ' + n.name);
}
for (const c of cambios) {
  const p = await estado(db, c.id);
  assert.equal(p.price, c.ahora, 'Precio nuevo de ' + c.nombre); assert.equal(p.original_price, null); assert.equal(p.offer_label, null, 'Sin oferta: ' + c.nombre);
  const esperado = c.reactivar || antes[c.id].availability !== 'agotado' ? (max(c.ahora) >= 7000 ? 'encargo' : 'disponible') : 'agotado';
  assert.equal(p.availability, esperado, 'Disponibilidad de ' + c.nombre);
}
assert(cambios.some(c => c.oferta_antes) && cambios.some(c => c.reactivar), 'Hay ofertas que terminan y un perfume que vuelve');
await db.exec(`insert into public.products (name, price) values ('Creado en el panel', 'RD$3,000')`);
assert.equal(Number((await one(db, `select id from public.products where name = 'Creado en el panel'`)).id), datos.ultimo_id + 1, 'El panel sigue numerando después del último');
await db.exec(`delete from public.products where name = 'Creado en el panel'`);
await db.exec('set role anon');
assert.equal((await db.query(`select id from public.products where id between $1 and $2`, [datos.primer_id, datos.ultimo_id])).rows.length, nuevos.length, 'La tienda los ve');
await throws(() => db.query('select * from private.precios_antes_20261016'), /permission denied/i, 'Un visitante no ve la copia de los precios');
await db.exec('reset role');

res = await aplicar(db);
assert.equal(Number(fila(res, 'agregados').hechos_ahora), 0, 'Repetirlo no duplica'); assert.equal(Number(fila(res, 'agregados').ya_estaban), nuevos.length);
assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), 0); assert.equal(Number(fila(res, 'Precios cambiados').ya_estaban), cambios.length);
assert.deepEqual(avisos(res), []);
console.log('perfumes nuevos y precios por el costo nuevo: aplicar y repetir OK');

// ---------------------------------------------------------------- Deshacer y volver a aplicar
res = await aplicar(db, DESHACER);
assert.equal(Number(fila(res, 'quitados').hechos_ahora), nuevos.length, 'Deshacer quita los nuevos');
assert.equal(Number(fila(res, 'devueltos').hechos_ahora), cambios.length, 'y devuelve los precios');
assert.deepEqual(avisos(res), []);
for (const c of cambios) assert.deepEqual(await estado(db, c.id), antes[c.id], 'Precio, oferta y disponibilidad de antes: ' + c.nombre);
assert.equal((await one(db, 'select count(*)::int as n from public.products')).n, totalAntes);
await db.exec(`insert into public.products (name, price) values ('Después de deshacer', 'RD$3,000')`);
assert.equal(Number((await one(db, `select id from public.products where name = 'Después de deshacer'`)).id), datos.primer_id, 'Tras deshacer, el panel vuelve a numerar desde el primero');
await db.exec(`delete from public.products where name = 'Después de deshacer'`);
res = await aplicar(db);
assert.equal(Number(fila(res, 'agregados').hechos_ahora), nuevos.length); assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length, 'Se puede volver a aplicar');
await db.close();
console.log('deshacer y volver a aplicar OK');

// ---------------------------------------------------------------- Lo cambiado a mano en el panel se respeta
{
  const otra = await base();
  const [a, b] = cambios.filter(c => !c.oferta_antes);
  await otra.query('update public.products set price = $2 where id = $1', [a.id, 'RD$9,999']);
  await otra.query('update public.products set name = $2 where id = $1', [b.id, 'Otro nombre']);
  res = await aplicar(otra);
  assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length - 2, 'Los demás sí cambian');
  assert.equal((await estado(otra, a.id)).price, 'RD$9,999', 'El precio puesto a mano se queda');
  assert.equal((await estado(otra, b.id)).price, b.antes, 'Un perfume con otro nombre no se toca');
  const lista = avisos(res).map(r => r.cambio);
  assert.equal(lista.length, 2, 'Avisa cuáles no se tocaron');
  assert(lista.some(t => t.includes('#' + a.id) && t.includes('RD$9,999') && t.includes(a.antes)) && lista.some(t => t.includes('#' + b.id) && t.includes('Otro nombre')), lista.join('\n'));
  res = await aplicar(otra, DESHACER);
  assert.equal((await estado(otra, a.id)).price, 'RD$9,999', 'Deshacer tampoco lo toca');
  await otra.close();
}
console.log('precio cambiado a mano: se respeta y se avisa OK');

// ---------------------------------------------------------------- Choque de números, falta el script anterior y pegado incompleto
{
  const otra = await base();
  await otra.exec(`insert into public.products (name, price) values ('Perfume creado en el panel', 'RD$2,500')`);
  const antesTotal = (await one(otra, 'select count(*)::int as n from public.products')).n;
  await throws(() => aplicar(otra), /ya están ocupados/, 'Si el número ' + datos.primer_id + ' ya es otro perfume, se detiene');
  assert.equal((await one(otra, 'select count(*)::int as n from public.products')).n, antesTotal, 'y no cambia nada');
  assert.equal((await estado(otra, cambios[0].id)).price, cambios[0].antes, 'ni los precios');
  const recortado = script.slice(0, Math.floor(script.length * 0.75));
  await otra.exec(`delete from public.products where name = 'Perfume creado en el panel'`);
  await throws(() => otra.exec(recortado), /./, 'Un pegado incompleto da error');
  assert.equal((await one(otra, 'select count(*)::int as n from public.products')).n, antesTotal - 1, 'y no deja nada a medias');
  await otra.close();
  const sinSep = await nuevaBase(PGlite);
  await throws(() => aplicar(sinSep), /30 de septiembre/, 'Sin el script del 30 de septiembre se detiene');
  await sinSep.close();
}
console.log('choque de números, falta del script anterior y pegado incompleto: no cambian nada OK');

// ---------------------------------------------------------------- Con todos los scripts de después (publicación automática, líneas de pedido, reseñas)
{
  const [oct3, lineas, oct7] = await Promise.all(['20261003120000_estadisticas_y_publicacion.sql', '20261003180000_lineas_de_pedido_y_existencias.sql',
    '20261007120000_mensajes_y_resenas.sql'].map(f => readFile('supabase/migrations/' + f, 'utf8')));
  const otra = await base();
  await otra.exec(`create schema if not exists vault; create table vault.secrets_stub (name text, secret text);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_stub;
    create schema if not exists net; create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
      returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;`);
  await otra.exec(oct3); await otra.exec(lineas); await otra.exec(oct7);
  await otra.exec(`insert into vault.secrets_stub values ('github_publish_token', 'tok-prueba')`);
  res = await aplicar(otra);
  assert.equal(Number(fila(res, 'agregados').hechos_ahora), nuevos.length); assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length);
  assert.equal((await one(otra, 'select count(*)::int as n from net.calls')).n, 1, 'Se pide publicar la web una sola vez');
  await otra.close();
}
console.log('con publicación automática, líneas de pedido y reseñas: OK (una sola publicación)');
console.log('CATÁLOGO DE LA GRADA DE OCTUBRE: TODO OK');
