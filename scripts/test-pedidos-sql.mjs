// Prueba de 20261003180000_lineas_de_pedido_y_existencias.sql con PostgreSQL embebido (PGlite): NO toca Supabase ni
// necesita claves. Comprueba que cada pedido se separa en líneas (también los viejos, con nombres escritos de varias
// formas), que «Lo más vendido» no se pierde al cambiar un nombre, la cantidad en casa (confirmar descuenta una sola vez;
// cancelar, volver a «nuevo» o borrar devuelve), «Agotado» automático solo cuando corresponde, «¡Quedan…!», permisos,
// que un error nunca impide guardar un pedido, repetir, deshacer y que un pegado incompleto no cambia nada.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-pedidos-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const SCRIPT = 'supabase/migrations/20261003180000_lineas_de_pedido_y_existencias.sql';
const [script, sep30, oct3] = await Promise.all([SCRIPT, 'supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql',
  'supabase/migrations/20261003120000_estadisticas_y_publicacion.sql'].map(f => readFile(f, 'utf8')));

// ---------------------------------------------------------------- El archivo
{
  const code = script.replace(/--[^\n]*/g, '');
  assert(/^-- LÍNEAS DE PEDIDO/.test(script) && /-- FIN\s*$/.test(script), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(/create temp table modo on commit drop as select false as deshacer;/.test(script), 'Queda en modo aplicar');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios (se puede correr desde GitHub)');
  const turno = code.indexOf('lock table public.products in access exclusive mode nowait');
  assert(turno > 0 && turno < code.indexOf('create table if not exists public.order_items') && turno < code.indexOf('alter table public.products add column'), 'Aparta perfumes y pedidos antes del primer cambio');
  assert(/lock table public\.orders in share row exclusive mode nowait/.test(code) && /exception when lock_not_available then\s+perform pg_sleep/.test(code), 'Si están ocupados, suelta todo y reintenta');
  assert.equal((code.match(/exception when others then\s+raise warning/g) || []).length, 2, 'Los dos disparadores de pedidos nunca detienen un pedido');
  assert(!/product_costs|pricing/.test(code), 'No toca costos ni la fórmula de precios');
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';

const db = await nuevaBase(PGlite);
await db.exec(sep30);
// Supabase trae Vault y pg_net: se imitan para contar cuántas veces se pide publicar la web.
await db.exec(`create schema if not exists vault; create table vault.secrets_stub (name text, secret text);
  create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_stub;
  create schema if not exists net; create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
    returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;`);
await db.exec(oct3);
await db.exec(`insert into vault.secrets_stub values ('github_publish_token', 'tok-prueba')`);
// La función de pedidos de la tienda (como la real): «1x Nombre (tamaño)», estado «nuevo», precio leído de la base.
await db.exec(`insert into public.admin_users values ('${ADMIN}');
create or replace function public.place_customer_order(p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_p public.products; v_text text := ''; v_total numeric := 0; v_qty integer; v_order public.orders;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión para ordenar.'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_p from public.products where id = (v_item->>'product_id')::bigint and active;
    if v_p.id is null then raise exception 'Uno de los productos ya no está disponible.'; end if;
    v_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
    v_total := v_total + coalesce((v_item->>'unit_price')::numeric, 0) * v_qty;
    v_text := v_text || v_qty || 'x ' || v_p.name || case when coalesce(v_item->>'size', '') <> '' then ' (' || (v_item->>'size') || ')' else '' end || E'\\n';
  end loop;
  insert into public.orders (customer_name, phone, items, amount, status, user_id)
  values ('Cliente web', '8095550000', trim(v_text), 'RD$' || to_char(v_total, 'FM999,999,999'), 'nuevo', auth.uid()) returning * into v_order;
  return jsonb_build_object('order_id', v_order.id);
end $$;
revoke execute on function public.place_customer_order(jsonb) from public, anon;
grant execute on function public.place_customer_order(jsonb) to authenticated;
-- Perfumes con casos especiales: varios tamaños, mismo nombre en dos tamaños, acentos y nombre que empieza con números.
update public.products set size = '100 ML' where id in (10, 11, 12, 20, 21);
update public.products set size = '60 / 100 ML', price = 'RD$3,450 / RD$4,150', availability = 'disponible' where id = 30;
update public.products set size = '100 ML' where id = 40;
update public.products set name = 'Perfume 40', size = '50 ML' where id = 41;
update public.products set name = 'Château Élite', size = '100 ML', availability = 'disponible' where id = 50;
update public.products set name = '9 PM EDP Men Afnan', size = '100 ML' where id = 61;
-- Pedidos que ya existen antes del script (escritos de varias formas).
insert into public.orders (customer_name, phone, items, amount, status) values
  ('A', '809', E'2x Perfume 10 (100 ML)\\n1x Perfume 20', 'RD$6,000', 'confirmado'),
  ('B', '809', '3 x Perfume 21', 'RD$6,000', 'entregado'),
  ('C', '809', E'1x Perfume 20 (100 ML)\\r\\n1x Perfume 10', 'RD$4,000', 'enviado'),
  ('D', '809', '9x Perfume 22', 'RD$9,000', 'cancelado'),
  ('E', '809', '8x Perfume 23', 'RD$9,000', 'nuevo'),
  ('F', '809', 'perfume 21; Perfume 11', 'RD$4,000', 'preparando'),
  ('G', '809', E'- chateau elite 100ml\\n1x Perfume 40 (50 ML)\\n1x Perfume 40 (100 ML)\\n2x 9 PM EDP Men Afnan (100 ML)\\nAlgo que no existe', 'RD$9,000', 'entregado'),
  ('H', '809', '1x Perfume 30 (100 ML)', 'RD$4,150', 'entregado'),
  ('I', '809', null, '', 'nuevo');`);
const antes = (await db.query('select * from public.best_sellers(365, 24)')).rows.map(r => Number(r.product_id));

// ---------------------------------------------------------------- Aplicar: separar los pedidos que ya existen
let res = (await db.exec(script)).at(-1).rows;
assert.deepEqual(res.map(r => r.estado), ['8 pedidos, 15 líneas (1 sin perfume reconocido)', 'lista: pon la cantidad en el panel (perfume por perfume); sin cantidad, todo sigue como hoy', 'cuenta con las líneas de pedido'], 'Resumen al aplicar');
const lineas = async customer => (await db.query(`select i.position, i.product_id, i.name, i.size, i.size_index, i.qty, i.unit_price, i.stock_taken
  from public.order_items i join public.orders o on o.id = i.order_id where o.customer_name = $1 order by i.position`, [customer])).rows
  .map(r => ({ ...r, product_id: r.product_id === null ? null : Number(r.product_id), unit_price: r.unit_price === null ? null : Number(r.unit_price) }));
assert.deepEqual((await lineas('A')).map(l => [l.product_id, l.qty, l.size, l.size_index]), [[10, 2, '100 ML', 0], [20, 1, null, 0]], 'Cantidad, perfume y tamaño');
assert.deepEqual((await lineas('B')).map(l => [l.product_id, l.qty]), [[21, 3]], '«3 x» con espacios');
assert.deepEqual((await lineas('C')).map(l => l.product_id), [20, 10], 'Saltos de línea de Windows');
assert.deepEqual((await lineas('F')).map(l => [l.product_id, l.qty]), [[21, 1], [11, 1]], 'Separados por punto y coma, sin importar mayúsculas');
const g = await lineas('G');
assert.deepEqual(g.map(l => l.product_id), [50, 41, 40, 61, null], 'Sin acentos, tamaño pegado al nombre, mismo nombre en dos tamaños, nombre con números y uno que no existe');
assert.deepEqual([g[0].size, g[3].qty, g[4].name], ['100ml', 2, 'Algo que no existe'], 'Se guarda lo escrito');
assert.deepEqual((await lineas('H')).map(l => [l.product_id, l.size_index]), [[30, 1]], 'El tamaño de «60 / 100 ML» por el número');
assert(g.every(l => l.unit_price === null && l.stock_taken === 0), 'Los pedidos viejos no inventan precios ni descuentan cantidades');
assert.equal((await lineas('I')).length, 0, 'Un pedido sin texto no tiene líneas');
const despues = (await db.query('select * from public.best_sellers(365, 24)')).rows.map(r => Number(r.product_id));
assert.deepEqual(despues.slice(0, 3), antes.slice(0, 3), '«Lo más vendido» da lo mismo que antes con los nombres de siempre');
assert(despues.includes(50) && despues.includes(41) && !antes.includes(50), 'y ahora también reconoce nombres sin acentos o con el tamaño pegado');
await db.exec(`update public.products set name = 'Perfume Diez (nuevo nombre)' where id = 10`);
assert((await db.query('select * from public.best_sellers(365, 24)')).rows.some(r => Number(r.product_id) === 10), 'Cambiar el nombre de un perfume no lo saca de «Lo más vendido»');
await db.exec(`update public.products set name = 'Perfume 10' where id = 10`);
console.log('líneas de pedidos viejos y «Lo más vendido» OK');

// ---------------------------------------------------------------- Pedidos nuevos desde la tienda
const as = async id => { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id || '']); };
const pedirWeb = async (user, items) => {
  await as(user); await db.exec('set role authenticated');
  try { return Number((await one(db, 'select public.place_customer_order_con_cupon($1::jsonb, null) as r', [JSON.stringify(items)])).r.order_id); }
  finally { await db.exec('reset role'); await as(''); }
};
const web = await pedirWeb(U1, [{ product_id: 30, qty: 1, size: '60', unit_price: 3450 }, { product_id: 12, qty: 2, size: '100 ML', unit_price: 2120 }]);
const webLines = (await db.query('select product_id, size, size_index, qty, unit_price, stock_taken from public.order_items where order_id = $1 order by position', [web])).rows;
assert.deepEqual(webLines.map(l => [Number(l.product_id), l.size, l.size_index, l.qty, Number(l.unit_price), l.stock_taken]), [[30, '60', 0, 1, 3450, 0], [12, '100 ML', 0, 2, 2120, 0]], 'Pedido de la tienda: perfume, tamaño, cantidad y precio de ese momento');
await db.exec(`update public.orders set amount = 'RD$7,000', notes = 'Cupón' where id = ${web}`);
assert.equal((await one(db, 'select count(*)::int as n from public.order_items where order_id = $1 and unit_price is not null', [web])).n, 2, 'Cambiar el total o las notas no vuelve a leer las líneas');
console.log('pedidos nuevos de la tienda OK');

// ---------------------------------------------------------------- Cantidad en casa
const stock = async (id, idx = 0) => { const r = await one(db, 'select qty from public.product_stock where product_id = $1 and size_index = $2', [id, idx]); return r ? r.qty : null; };
const prod = async id => one(db, 'select availability, stock_left from public.products where id = $1', [id]);
const marca = async id => (await one(db, 'select count(*)::int as n from private.stock_auto where product_id = $1', [id])).n;
const publicaciones = async () => (await one(db, 'select count(*)::int as n from net.calls')).n;
const sinEspera = () => db.exec('update private.publish_state set last_request = null');
const estado = async (id, status) => { await db.exec(`update public.orders set status = '${status}' where id = ${id}`); };
const pedido = async (items, status = 'nuevo') => Number((await one(db, `insert into public.orders (customer_name, phone, items, amount, status) values ('Panel', '809', $1, 'RD$1', $2) returning id`, [items, status])).id);
const panel = async sql => { await as(ADMIN); await db.exec('set role authenticated'); try { return await db.query(sql); } finally { await db.exec('reset role'); await as(''); } };

// El dueño pone 2 en casa del perfume 12 (desde el panel).
await sinEspera(); let antesPub = await publicaciones();
await panel(`insert into public.product_stock (product_id, size_index, qty) values (12, 0, 2)`);
assert.deepEqual(await prod(12), { availability: 'disponible', stock_left: 2 }, 'Con 2 en casa la tienda muestra «¡Quedan 2!»');
assert.equal(await publicaciones(), antesPub + 1, 'y se vuelve a publicar la web una vez');
// El pedido de la tienda (nuevo) no aparta nada; al confirmarlo se descuenta una sola vez.
assert.equal(await stock(12), 2, 'Un pedido «nuevo» no descuenta');
await estado(web, 'confirmado');
assert.equal(await stock(12), 0, 'Al confirmar se descuentan los 2');
assert.deepEqual(await prod(12), { availability: 'agotado', stock_left: 0 }, 'Llega a 0: «Agotado» automático');
assert.equal(await marca(12), 1);
for (const s of ['preparando', 'enviado', 'entregado']) await estado(web, s);
assert.equal(await stock(12), 0, 'Pasar a enviado o entregado no descuenta otra vez');
// Cancelar devuelve y vuelve a «Disponible» (solo porque se agotó solo).
await sinEspera(); antesPub = await publicaciones();
await estado(web, 'cancelado');
assert.equal(await stock(12), 2, 'Cancelar devuelve lo descontado');
assert.deepEqual(await prod(12), { availability: 'disponible', stock_left: 2 }, 'y vuelve a «Disponible»');
assert.equal(await publicaciones(), antesPub + 1, 'Un cambio de estado pide publicar una sola vez');
assert.equal(await marca(12), 0);
// Un pedido registrado ya confirmado desde el panel, con más de lo que hay: descuenta lo que hay.
const p2 = await pedido('3x Perfume 12 (100 ML)', 'confirmado');
assert.equal(await stock(12), 0, 'Se descuenta lo que hay (no queda negativo)');
assert.equal((await one(db, 'select stock_taken from public.order_items where order_id = $1', [p2])).stock_taken, 2, 'y se anota cuánto se descontó');
await estado(p2, 'nuevo');
assert.equal(await stock(12), 2, 'Volver a «nuevo» devuelve exactamente eso');
// Cambiar el texto de un pedido confirmado: devuelve lo del texto viejo y descuenta lo del nuevo.
await panel(`insert into public.product_stock (product_id, size_index, qty) values (11, 0, 5)`);
await estado(p2, 'confirmado'); assert.equal(await stock(12), 0);
await db.exec(`update public.orders set items = '1x Perfume 11 (100 ML)' where id = ${p2}`);
assert.deepEqual([await stock(12), await stock(11)], [2, 4], 'Cambiar las líneas de un pedido confirmado mueve las cantidades');
assert.equal((await prod(11)).stock_left, null, 'Con más de 3 no se muestra la cantidad');
// Borrar un pedido devuelve lo descontado.
await db.exec(`delete from public.orders where id = ${p2}`);
assert.equal(await stock(11), 5, 'Borrar un pedido devuelve lo descontado');
assert.equal((await one(db, 'select count(*)::int as n from public.order_items where order_id = $1', [p2])).n, 0, 'y se borran sus líneas');
// Varios tamaños: cada tamaño lleva su cantidad.
await panel(`insert into public.product_stock (product_id, size_index, qty) values (30, 0, 1), (30, 1, 4)`);
const p3 = await pedido('1x Perfume 30 (60 ML)', 'confirmado');
assert.deepEqual([await stock(30, 0), await stock(30, 1)], [0, 4], 'Se descuenta del tamaño pedido');
assert.deepEqual(await prod(30), { availability: 'disponible', stock_left: null }, 'Mientras quede otro tamaño sigue disponible');
await estado(p3, 'cancelado');
// Lo que decide el dueño se respeta: «Agotado» a mano no vuelve solo a «Disponible»; «Solo por encargo» no cambia.
await db.exec(`update public.products set availability = 'agotado' where id = 11`);
await panel(`update public.product_stock set qty = 6 where product_id = 11`);
assert.equal((await prod(11)).availability, 'agotado', '«Agotado» puesto a mano se respeta aunque haya cantidad');
await db.exec(`update public.products set availability = 'disponible' where id = 11`);
assert.equal((await one(db, 'select availability from public.products where id = 7')).availability, 'encargo');
await panel(`insert into public.product_stock (product_id, size_index, qty) values (7, 0, 1)`);
const p4 = await pedido('1x Perfume 7', 'confirmado');
assert.deepEqual([await stock(7), (await prod(7)).availability], [0, 'encargo'], '«Solo por encargo» no pasa a «Agotado»');
await estado(p4, 'cancelado');
// Volver a poner cantidad a un agotado automático lo devuelve a «Disponible»; quitar la cantidad deja todo como hoy.
await panel(`update public.product_stock set qty = 0 where product_id = 12`);
assert.deepEqual(await prod(12), { availability: 'agotado', stock_left: 0 });
await panel(`update public.product_stock set qty = 3 where product_id = 12`);
assert.deepEqual(await prod(12), { availability: 'disponible', stock_left: 3 }, 'Llega mercancía: «Disponible» y «¡Quedan 3!»');
await panel(`delete from public.product_stock where product_id = 12`);
assert.deepEqual(await prod(12), { availability: 'disponible', stock_left: null }, 'Sin cantidad, como hoy');
// Un perfume sin cantidad no cambia nunca por los pedidos.
const p5 = await pedido('5x Perfume 13', 'confirmado');
assert.deepEqual(await prod(13), { availability: 'disponible', stock_left: null }, 'Sin cantidad en casa, los pedidos no lo agotan');
await db.exec(`delete from public.orders where id = ${p5}`);
console.log('cantidad en casa, «Agotado» automático y «¡Quedan…!» OK');

// ---------------------------------------------------------------- Un error nunca impide guardar, cambiar ni borrar un pedido
await db.exec(`alter table public.order_items add constraint prueba_rota check (qty < 0) not valid`);
const roto = await pedido('1x Perfume 14', 'confirmado');
assert(roto > 0 && (await one(db, 'select count(*)::int as n from public.order_items where order_id = $1', [roto])).n === 0, 'Si fallan las líneas, el pedido se guarda igual');
await db.exec(`alter table public.order_items drop constraint prueba_rota`);
await panel(`insert into public.product_stock (product_id, size_index, qty) values (15, 0, 4)`);
const p6 = await pedido('2x Perfume 15', 'nuevo');
await db.exec(`alter table public.product_stock add constraint prueba_rota check (qty > 100) not valid`);
await estado(p6, 'confirmado');
assert.equal((await one(db, 'select status from public.orders where id = $1', [p6])).status, 'confirmado', 'Si falla la cantidad, el cambio de estado se guarda igual');
assert.equal(await stock(15), 4, 'y la cantidad queda como estaba (nada a medias)');
await db.exec(`delete from public.orders where id = ${p6}`);
assert.equal((await one(db, 'select count(*)::int as n from public.orders where id = $1', [p6])).n, 0, 'Y borrar también funciona');
await db.exec(`alter table public.product_stock drop constraint prueba_rota`);
console.log('un error nunca detiene un pedido OK');

// ---------------------------------------------------------------- Permisos
await db.exec('set role anon');
await throws(() => db.query('select * from public.order_items'), /permission denied/i, 'Un visitante no ve líneas de pedido');
await throws(() => db.query('select * from public.product_stock'), /permission denied/i, 'Ni la cantidad en casa');
await throws(() => db.query('select private.refresh_stock_state(array[1::bigint])'), /permission denied/i, 'Ni usa las funciones internas');
assert.equal((await one(db, 'select stock_left from public.products where id = 11')).stock_left, null, 'Ve «¡Quedan…!» (solo de 0 a 3)');
await db.exec('reset role'); await as(U2); await db.exec('set role authenticated');
assert.equal((await db.query('select * from public.order_items')).rows.length, 0, 'Un cliente no ve líneas de pedido');
assert.equal((await db.query('select * from public.product_stock')).rows.length, 0, 'Ni la cantidad en casa');
await throws(() => db.query('insert into public.product_stock (product_id, qty) values (16, 1)'), /row-level security/i, 'Ni la cambia');
await throws(() => db.query('select private.sync_order(1, true, true, true, true)'), /permission denied/i, 'Ni usa las funciones internas');
await db.exec('reset role'); await as(ADMIN); await db.exec('set role authenticated');
assert((await db.query('select * from public.order_items')).rows.length > 10, 'El administrador ve las líneas');
await throws(() => db.query('insert into public.order_items (order_id, position, name, qty) values (1, 99, \'x\', 1)'), /permission denied/i, 'Las líneas solo las escribe la base de datos');
await db.exec('reset role'); await as('');
console.log('permisos OK');

// ---------------------------------------------------------------- Repetir, deshacer y volver a aplicar
const contar = async () => (await one(db, 'select count(*)::int as n, coalesce(sum(stock_taken), 0)::int as t from public.order_items'));
const antesRep = await contar(), stockAntes = await db.query('select * from public.product_stock order by 1, 2');
res = (await db.exec(script)).at(-1).rows;
assert.deepEqual(await contar(), { n: antesRep.n + 1, t: antesRep.t }, 'Repetirlo no duplica líneas ni descuenta otra vez: solo completa el pedido que quedó sin líneas por el error');
assert.equal((await one(db, 'select count(*)::int as n from public.order_items where order_id = $1', [roto])).n, 1);
assert.deepEqual((await db.query('select * from public.product_stock order by 1, 2')).rows, stockAntes.rows);
res = (await db.exec(script.replace('select false as deshacer;', 'select true as deshacer;'))).at(-1).rows;
assert.deepEqual(res.map(r => r.estado), ['quitadas', 'quitada', 'lee el texto de los pedidos (como antes)'], 'Deshacer');
assert.equal((await one(db, `select to_regclass('public.order_items') as t`)).t, null);
assert.equal((await one(db, `select count(*)::int as n from information_schema.columns where table_name = 'products' and column_name = 'stock_left'`)).n, 0, 'Se quita la columna «¡Quedan…!»');
assert.equal((await one(db, `select count(*)::int as n from pg_trigger where tgname in ('orders_lines_after', 'orders_return_stock', 'products_forget_stock_auto')`)).n, 0, 'Y los disparadores');
assert((await db.query('select * from public.best_sellers(365, 24)')).rows.length > 0, '«Lo más vendido» vuelve a leer el texto');
await pedido('1x Perfume 16', 'confirmado'); // sin el script, los pedidos funcionan como siempre
res = (await db.exec(script)).at(-1).rows;
assert.match(res[0].estado, /^\d+ pedidos, \d+ líneas/, 'Se puede volver a aplicar');
// Pegado incompleto: no cambia nada.
{
  const limpio = await nuevaBase(PGlite); await limpio.exec(sep30);
  await throws(() => limpio.exec(script.slice(0, Math.floor(script.length * 0.6))), /./, 'Un pegado incompleto da error');
  assert.equal((await one(limpio, `select to_regclass('public.order_items') as t`)).t, null, 'y no deja nada a medias');
  await limpio.close();
}
await db.close();
console.log('repetir, deshacer y pegado incompleto OK');
console.log('TODAS LAS PRUEBAS DE LÍNEAS DE PEDIDO Y CANTIDAD EN CASA PASARON');
