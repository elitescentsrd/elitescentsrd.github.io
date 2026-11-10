// Prueba de 20261110180000_precios_mas_ganancia.sql con PostgreSQL embebido (PGlite): NO toca Supabase ni necesita
// claves. Sobre la tienda de prueba con los scripts del 30 de septiembre y de octubre ya aplicados, tanto sin como con el
// script de precios de noviembre (que este reemplaza), comprueba: los precios que cambian (los de RD$7,000 o más quedan
// «Solo por encargo»), que un precio cambiado a mano o una oferta puesta en el panel no se tocan y se avisa, repetir sin
// duplicar, deshacer (devuelve precio y disponibilidad), la falta del script de octubre y un pegado incompleto.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-precios-mas-ganancia-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const DATOS = 'data/precios-2026-11.json';
const datos = JSON.parse(await readFile(DATOS, 'utf8'));
const [script, sep30, oct16] = await Promise.all([datos.aplicar_con, 'supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql',
  'supabase/migrations/20261016120000_catalogo_la_grada_octubre.sql'].map(f => readFile(f, 'utf8')));
const cambios = Object.entries(datos.precios).map(([id, c]) => ({ id: Number(id), ...c }));
const max = price => Math.max(...price.match(/[0-9][0-9,]*/g).map(v => Number(v.replace(/,/g, ''))));

// ---------------------------------------------------------------- El archivo (público: nunca costos ni la fórmula)
{
  const code = script.replace(/--[^\n]*/g, '');
  assert(/^-- PRECIOS NUEVOS CON MÁS GANANCIA/.test(script) && /-- FIN\s*$/.test(script), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(/create temp table modo on commit drop as select false as deshacer;/.test(script), 'Queda en modo aplicar');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios (se puede correr desde GitHub)');
  assert(!/product_costs|pricing|costo/i.test(code), 'No trae costos ni la fórmula de precios');
  const turno = code.indexOf('lock table public.products in share row exclusive mode nowait');
  assert(turno > 0 && turno < code.indexOf('update public.products'), 'Aparta los perfumes antes del primer cambio');
  assert(/exception when lock_not_available then\s+perform pg_sleep/.test(code), 'Si están ocupados, suelta todo y reintenta');
  assert(!/costo|margen|ganancia|"cost|estrategia|strategy|competid/i.test(JSON.stringify(datos.precios)), 'El archivo público de datos no tiene costos');
  assert(cambios.length > 0 && cambios.every(c => [c.ahora, c.antes, c.antes_nov ?? c.antes].every(v => /^RD\$[0-9,]+( \/ RD\$[0-9,]+)*$/.test(v)) && c.antes !== c.ahora && c.antes_nov !== c.ahora), 'Precios bien escritos y distintos');
  for (const c of cambios) assert(script.includes(`(${c.id}, '${c.nombre.replace(/'/g, "''")}', '${c.antes}', ${c.antes_nov ? `'${c.antes_nov}'` : 'null'}, '${c.ahora}')`), 'El script trae el cambio de ' + c.nombre);
  assert.equal((script.match(/^\s*\(\d+, '/gm) || []).length, cambios.length, 'Ni más ni menos cambios que en el archivo de datos');
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const aplicar = async (db, sql = script) => (await db.exec(sql)).at(-1).rows;
const fila = (rows, texto) => rows.find(r => r.cambio.includes(texto));
const avisos = rows => rows.filter(r => r.cambio.startsWith('No se tocó'));
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const DESHACER = script.replace('select false as deshacer;', 'select true as deshacer;');

// La tienda como está hoy: septiembre y octubre aplicados y los perfumes que cambian con su nombre y su precio de hoy
// (conNoviembre: con el precio que puso el script de noviembre, para quien ya lo aplicó).
const hoy = (c, conNoviembre) => conNoviembre ? c.antes_nov ?? c.antes : c.antes;
async function base(conNoviembre = false) {
  const db = await nuevaBase(PGlite);
  await db.exec(sep30); await db.exec(oct16);
  for (const c of cambios) {
    await db.query(`update public.products set name = $2, price = $3, original_price = null, offer_label = null, offer_ends_at = null,
      availability = case when $4 then 'encargo' else 'disponible' end where id = $1`, [c.id, c.nombre, hoy(c, conNoviembre), max(hoy(c, conNoviembre)) >= 7000]);
  }
  return db;
}
const estado = async (db, id) => one(db, 'select name, price, original_price, offer_label, offer_ends_at, availability from public.products where id = $1', [id]);

// ---------------------------------------------------------------- Aplicar y repetir (sin y con el script de noviembre)
let res;
for (const conNoviembre of [false, true]) {
const db = await base(conNoviembre);
const antes = Object.fromEntries(await Promise.all(cambios.map(async c => [c.id, await estado(db, c.id)])));
const totalAntes = (await one(db, 'select count(*)::int as n from public.products')).n;
res = await aplicar(db);
assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length, 'Se cambian los precios');
assert.deepEqual(avisos(res), [], 'Sin avisos cuando la tienda está como se esperaba');
assert.equal((await one(db, 'select count(*)::int as n from public.products')).n, totalAntes, 'No agrega ni quita perfumes');
for (const c of cambios) {
  const p = await estado(db, c.id);
  assert.equal(p.price, c.ahora, 'Precio nuevo de ' + c.nombre); assert.equal(p.original_price, null);
  assert.equal(p.availability, max(c.ahora) >= 7000 ? 'encargo' : 'disponible', 'Disponibilidad de ' + c.nombre);
}
assert(cambios.some(c => max(c.ahora) >= 7000 && max(c.antes) < max(c.ahora)), 'Hay perfumes de RD$7,000 o más que suben');
assert(cambios.some(c => c.antes_nov) && cambios.every(c => max(c.ahora) > max(c.antes_nov ?? c.antes)), 'Con la fórmula nueva solo suben (respecto a noviembre)');
await db.exec('set role anon');
await throws(() => db.query('select * from private.precios_antes_margen_20261110'), /permission denied/i, 'Un visitante no ve la copia de los precios');
await db.exec('reset role');

res = await aplicar(db);
assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), 0, 'Repetirlo no cambia nada'); assert.equal(Number(fila(res, 'Precios cambiados').ya_estaban), cambios.length);
assert.deepEqual(avisos(res), []);
console.log('precios con más ganancia' + (conNoviembre ? ' (con noviembre ya aplicado)' : '') + ': aplicar y repetir OK');

// ---------------------------------------------------------------- Deshacer y volver a aplicar
res = await aplicar(db, DESHACER);
assert.equal(Number(fila(res, 'devueltos').hechos_ahora), cambios.length, 'Deshacer devuelve los precios');
assert.deepEqual(avisos(res), []);
for (const c of cambios) assert.deepEqual(await estado(db, c.id), antes[c.id], 'Precio y disponibilidad de antes: ' + c.nombre);
res = await aplicar(db, DESHACER);
assert.equal(Number(fila(res, 'devueltos').hechos_ahora), 0, 'Deshacer dos veces no hace nada más'); assert.equal(Number(fila(res, 'devueltos').ya_estaban), cambios.length);
assert.deepEqual(avisos(res), []);
res = await aplicar(db);
assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length, 'Se puede volver a aplicar');
await db.close();
console.log('deshacer y volver a aplicar OK');
}

// ---------------------------------------------------------------- Lo cambiado a mano en el panel se respeta
{
  const otra = await base();
  const [a, b, o] = cambios;
  await otra.query('update public.products set price = $2 where id = $1', [a.id, 'RD$9,999']);
  await otra.query('update public.products set name = $2 where id = $1', [b.id, 'Otro nombre']);
  await otra.query(`update public.products set original_price = price, price = 'RD$1,000', offer_label = 'Oferta', offer_ends_at = now() + interval '3 days' where id = $1`, [o.id]);
  const conOferta = await estado(otra, o.id);
  res = await aplicar(otra);
  assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length - 3, 'Los demás sí cambian');
  assert.equal((await estado(otra, a.id)).price, 'RD$9,999', 'El precio puesto a mano se queda');
  assert.equal((await estado(otra, b.id)).price, b.antes, 'Un perfume con otro nombre no se toca');
  assert.deepEqual(await estado(otra, o.id), conOferta, 'Una oferta puesta en el panel no se toca');
  const lista = avisos(res).map(r => r.cambio);
  assert.equal(lista.length, 3, 'Avisa cuáles no se tocaron');
  assert(lista.some(t => t.includes('#' + a.id) && t.includes('RD$9,999') && t.includes(a.antes)), lista.join('\n'));
  assert(lista.some(t => t.includes('#' + b.id) && t.includes('Otro nombre')), lista.join('\n'));
  assert(lista.some(t => t.includes('#' + o.id) && t.includes('oferta')), lista.join('\n'));
  res = await aplicar(otra, DESHACER);
  assert.equal((await estado(otra, a.id)).price, 'RD$9,999', 'Deshacer tampoco lo toca');
  assert.equal(Number(fila(res, 'devueltos').hechos_ahora), cambios.length - 3, 'Deshacer devuelve solo los que cambió');
  await otra.close();
}
console.log('precio cambiado a mano y oferta del panel: se respetan y se avisa OK');

// ---------------------------------------------------------------- Falta el script de octubre y pegado incompleto
{
  const otra = await base();
  const recortado = script.slice(0, Math.floor(script.length * 0.75));
  await throws(() => otra.exec(recortado), /./, 'Un pegado incompleto da error');
  for (const c of cambios) assert.equal((await estado(otra, c.id)).price, c.antes, 'y no deja nada a medias');
  await otra.close();
  const sinOct = await nuevaBase(PGlite);
  await sinOct.exec(sep30);
  await throws(() => aplicar(sinOct), /octubre/, 'Sin el script de octubre se detiene');
  await sinOct.close();
}
console.log('falta del script de octubre y pegado incompleto: no cambian nada OK');

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
  assert.equal(Number(fila(res, 'Precios cambiados').hechos_ahora), cambios.length);
  assert.equal((await one(otra, 'select count(*)::int as n from net.calls')).n, 1, 'Se pide publicar la web una sola vez');
  await otra.close();
}
console.log('con publicación automática, líneas de pedido y reseñas: OK (una sola publicación)');
console.log('PRECIOS NUEVOS CON MÁS GANANCIA: TODO OK');
