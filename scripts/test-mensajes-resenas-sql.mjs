// Prueba de 20261007120000_mensajes_y_resenas.sql con PostgreSQL embebido (PGlite): NO toca Supabase ni necesita claves.
// Comprueba el formulario de contacto (datos válidos, WhatsApp de aquí y de afuera, límites, limpieza y que solo el
// administrador lee los mensajes), las reseñas verificadas (solo pedidos entregados, un enlace por pedido, una reseña por
// perfume, nada se ve hasta publicarla y la tienda nunca ve el pedido ni la conexión), la publicación automática al
// publicar una reseña, permisos, repetir, deshacer y que un pegado incompleto no cambia nada.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-mensajes-resenas-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const SCRIPT = 'supabase/migrations/20261007120000_mensajes_y_resenas.sql';
const [script, sep30, oct3, lineas] = await Promise.all([SCRIPT, 'supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql',
  'supabase/migrations/20261003120000_estadisticas_y_publicacion.sql', 'supabase/migrations/20261003180000_lineas_de_pedido_y_existencias.sql'].map(f => readFile(f, 'utf8')));

// ---------------------------------------------------------------- El archivo
{
  const code = script.replace(/--[^\n]*/g, '');
  assert(/^-- MENSAJES Y RESEÑAS/.test(script) && /-- FIN\s*$/.test(script), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(/create temp table modo on commit drop as select false as deshacer;/.test(script), 'Queda en modo aplicar');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios (se puede correr desde GitHub)');
  const turno = code.indexOf('lock table public.products, public.orders in share row exclusive mode nowait');
  assert(turno > 0 && turno < code.indexOf('create table if not exists public.contact_messages'), 'Aparta perfumes y pedidos antes del primer cambio');
  assert(/exception when lock_not_available then\s+perform pg_sleep/.test(code), 'Si están ocupados, suelta todo y reintenta');
  assert(!/product_costs|pricing/.test(code), 'No toca costos ni la fórmula de precios');
  assert(/grant select \(id, product_id, author_name, rating, comment, created_at\) on public\.product_reviews to anon, authenticated;/.test(code), 'La tienda solo puede leer las columnas públicas de las reseñas');
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';

// Base con los scripts anteriores (Supabase trae Vault y pg_net: se imitan para contar cuántas veces se pide publicar la web).
async function base({ conLineas = true } = {}) {
  const db = await nuevaBase(PGlite);
  await db.exec(sep30);
  await db.exec(`create schema if not exists vault; create table vault.secrets_stub (name text, secret text);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_stub;
    create schema if not exists net; create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
      returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;`);
  await db.exec(oct3);
  if (conLineas) await db.exec(lineas);
  return db;
}

// Sin el script de líneas de pedido se detiene con un mensaje claro y no cambia nada.
{
  const sin = await base({ conLineas: false });
  await throws(() => sin.exec(script), /LÍNEAS DE PEDIDO/, 'Pide primero el script de líneas de pedido');
  assert.equal((await one(sin, `select to_regclass('public.contact_messages') as t`)).t, null, 'y no deja nada a medias');
  await sin.close();
}

const db = await base();
await db.exec(`insert into public.admin_users values ('${ADMIN}'); insert into vault.secrets_stub values ('github_publish_token', 'tok-prueba');`);
let res = (await db.exec(script)).at(-1).rows;
assert.deepEqual(res.map(r => r.estado), ['listos: llegan a la sección «Mensajes» del panel (0 guardados)',
  'listas: en «Pedidos», los entregados tienen «Pedir reseña» (0 publicadas, 0 por revisar)', 'lista (usa la publicación automática del 3 de octubre)'], 'Resumen al aplicar');

const as = async id => { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id || '']); };
const desde = async ip => { await db.query(`select set_config('request.headers', $1, false)`, [ip ? JSON.stringify({ 'cf-connecting-ip': ip }) : '']); };
const como = async (role, user, fn) => { await as(user); await db.exec('set role ' + role); try { return await fn(); } finally { await db.exec('reset role'); await as(''); } };
const anon = fn => como('anon', '', fn);
const admin = fn => como('authenticated', ADMIN, fn);
const cliente = (user, fn) => como('authenticated', user, fn);

// ---------------------------------------------------------------- Mensajes de «Contacto»
const enviar = async (nombre, tel, tema, texto) => anon(async () => (await one(db, 'select public.send_contact_message($1, $2, $3, $4) as r', [nombre, tel, tema, texto])).r);
const mensajes = async () => (await db.query('select name, phone, topic, message, status, ip_hash is not null as con_ip from public.contact_messages order by id')).rows;

await desde('200.1.1.1');
let r = await enviar('  Ana   Pérez ', '809-555-1234', 'perfume', 'Hola, ¿tienen Asad en 100 ml?');
assert.deepEqual([r.ok, r.message], [true, 'Listo, Ana: recibimos tu mensaje y te responderemos por WhatsApp.'], 'Un mensaje válido se guarda');
await desde('200.1.1.2');
assert.equal((await enviar('Luis', '+1 (829) 555-0000', 'pedido', 'Quiero saber de mi pedido 12')).ok, true, 'Número dominicano con +1');
assert.equal((await enviar('Carmen', '18495550001', 'envio', 'Hacen envíos a Santiago?')).ok, true, 'Número dominicano con 1 delante');
await desde('200.1.1.3');
assert.equal((await enviar('Marta', '+34 612 345 678', 'raro', 'Hola desde España')).ok, true, 'Número de otro país con +');
assert.equal((await enviar('Pedro', '0034 612 345 679', '', 'Hola desde España otra vez')).ok, true, 'Número de otro país con 00');
assert.equal((await enviar('Rafa', '+809 555 2222', '', 'Puse el + sin el 1')).ok, true, 'Número dominicano escrito con + pero sin el 1');
let guardados = await mensajes();
assert.deepEqual(guardados.map(m => [m.name, m.phone, m.topic]), [['Ana Pérez', '8095551234', 'perfume'], ['Luis', '8295550000', 'pedido'], ['Carmen', '8495550001', 'envio'],
  ['Marta', '+34612345678', 'otro'], ['Pedro', '+34612345679', 'otro'], ['Rafa', '8095552222', 'otro']], 'Nombre sin espacios de más, WhatsApp normalizado y tema conocido (si no, «otro»)');
assert(guardados.every(m => m.status === 'nuevo' && m.con_ip), 'Llegan como «nuevo» y con la huella de conexión (para los límites)');

await desde('200.1.1.4');
for (const [nombre, tel, texto, patron, label] of [
  ['A', '8095551234', 'Hola hola', /tu nombre/, 'Nombre muy corto'],
  ['<b>Ana</b>', '8095551234', 'Hola hola', /tu nombre/, 'Nombre con código'],
  ['12345', '8095551234', 'Hola hola', /tu nombre/, 'Nombre sin letras'],
  ['Ana', '12345', 'Hola hola', /WhatsApp/, 'Teléfono inválido'],
  ['Ana', '7865551234', 'Hola hola', /WhatsApp/, 'Número de 10 dígitos que no es dominicano (sin +)'],
  ['Ana', '+12', 'Hola hola', /WhatsApp/, 'Número de otro país muy corto'],
  ['Ana', '0012', 'Hola hola', /WhatsApp/, 'Número con 00 muy corto'],
  ['Ana', '8095551234', 'hey', /de 5 a 1,000/, 'Mensaje muy corto'],
  ['Ana', '8095551234', 'x'.repeat(1001), /de 5 a 1,000/, 'Mensaje muy largo'],
  ['Ana', '8095551234', 'mira http://a.com http://b.com https://c.com', /enlaces/, 'Muchos enlaces'],
]) { r = await enviar(nombre, tel, 'otro', texto); assert(r.ok === false && patron.test(r.message), label + ': ' + r.message); }
assert.equal((await mensajes()).length, 6, 'Nada inválido se guarda');

r = await enviar('Ana Pérez', '8095551234', 'perfume', 'Hola, ¿tienen Asad en 100 ml?');
assert.deepEqual([r.ok, r.already], [true, true], 'El mismo mensaje repetido no se duplica');
await desde('200.1.1.5');
assert.equal((await enviar('Rosa', '8095557777', 'otro', E('Hola\u0007 mundo\r\n\r\n\r\n\r\nfin   aquí  '))).ok, true);
assert.equal((await one(db, `select message from public.contact_messages where name = 'Rosa'`)).message, 'Hola mundo\n\nfin aquí', 'Sin caracteres raros ni líneas vacías de más');
function E(s) { return s; }

// Límites: 3 cada 10 minutos por conexión, 5 al día por número y 100 por hora en total.
await desde('200.2.2.2');
for (let i = 1; i <= 3; i++) assert.equal((await enviar('Bot', '8095550' + String(100 + i), 'otro', 'Mensaje número ' + i)).ok, true);
r = await enviar('Bot', '8095550200', 'otro', 'Mensaje número 4');
assert(r.ok === false && /varias veces/.test(r.message), 'Al cuarto mensaje en 10 minutos desde la misma conexión, espera');
for (let i = 1; i <= 5; i++) { await desde('201.0.0.' + i); assert.equal((await enviar('Juan', '8295551111', 'otro', 'Consulta número ' + i)).ok, true); }
await desde('201.0.0.9');
r = await enviar('Juan', '8295551111', 'otro', 'Consulta número 6');
assert(r.ok === false && /varios mensajes de este número/.test(r.message), 'Máximo 5 mensajes al día por número');
await db.exec(`insert into public.contact_messages (name, phone, message, created_at) select 'Viejo', '8095550000', 'mensaje viejo', now() - interval '5 minutes' from generate_series(1, 100)`);
await desde('202.0.0.1');
r = await enviar('Nuevo', '8095550001', 'otro', 'Hola tienda');
assert(r.ok === false && /no podemos recibir/.test(r.message), 'Máximo 100 mensajes por hora en total');
await db.exec(`delete from public.contact_messages where name = 'Viejo'`);
// Limpieza: atendidos de más de 180 días, cualquiera de más de un año y la huella de conexión a los 7 días.
await db.exec(`insert into public.contact_messages (name, phone, message, status, attended_at, created_at, ip_hash) values
  ('Atendido viejo', '8095550000', 'mensaje', 'atendido', now() - interval '200 days', now() - interval '201 days', null),
  ('Sin atender viejo', '8095550000', 'mensaje', 'nuevo', null, now() - interval '400 days', null),
  ('Atendido reciente', '8095550000', 'mensaje', 'atendido', now() - interval '10 days', now() - interval '11 days', 'huella'),
  ('Pendiente de hace un mes', '8095550000', 'mensaje', 'nuevo', null, now() - interval '30 days', 'huella')`);
assert.equal((await enviar('Nuevo', '8095550001', 'otro', 'Hola tienda')).ok, true);
assert.deepEqual((await db.query(`select name, ip_hash from public.contact_messages where name in ('Atendido viejo', 'Sin atender viejo', 'Atendido reciente', 'Pendiente de hace un mes') order by id`)).rows,
  [{ name: 'Atendido reciente', ip_hash: null }, { name: 'Pendiente de hace un mes', ip_hash: null }], 'Se borran los viejos y la huella de conexión a los 7 días');
console.log('mensajes de contacto OK');

// Quién puede leer y cambiar los mensajes.
await anon(async () => {
  await throws(() => db.query('select * from public.contact_messages'), /permission denied/i, 'Un visitante no lee los mensajes');
  await throws(() => db.query(`insert into public.contact_messages (name, phone, message) values ('X', '8095551234', 'hola hola')`), /permission denied/i, 'Ni los escribe sin la función');
});
await cliente(U1, async () => {
  assert.equal((await db.query('select * from public.contact_messages')).rows.length, 0, 'Un cliente con cuenta no ve los mensajes');
  assert.equal((await db.query(`update public.contact_messages set status = 'atendido' returning id`)).rows.length, 0, 'Ni los marca');
  assert.equal((await db.query('delete from public.contact_messages returning id')).rows.length, 0, 'Ni los borra');
});
await admin(async () => {
  const todos = (await db.query('select id, status from public.contact_messages order by id')).rows;
  assert(todos.length >= 10, 'El administrador ve todos los mensajes');
  assert.equal((await db.query(`update public.contact_messages set status = 'atendido', attended_at = now() where id = $1 returning id`, [todos[0].id])).rows.length, 1, 'Los marca como atendidos');
  await throws(() => db.query(`update public.contact_messages set message = 'otro' where id = $1`, [todos[0].id]), /permission denied/i, 'No puede cambiar lo que escribió el cliente');
  assert.equal((await db.query('delete from public.contact_messages where id = $1 returning id', [todos[1].id])).rows.length, 1, 'Los borra');
});
console.log('permisos de los mensajes OK');

// ---------------------------------------------------------------- Reseñas verificadas
// Pedidos: entregado (2 perfumes de la tienda y una línea desconocida), nuevo, entregado sin perfumes reconocidos y uno web.
const pedido = async (nombre, items, status, user = null) => Number((await one(db, `insert into public.orders (customer_name, phone, items, amount, status, user_id) values ($1, '8095551111', $2, 'RD$1', $3, $4) returning id`, [nombre, items, status, user])).id);
const entregado = await pedido('maría josé pérez', '1x Perfume 10 (100 ML)\n2x Perfume 20\n1x Algo que no existe', 'entregado');
const nuevo = await pedido('Pedro', '1x Perfume 11', 'nuevo');
const raro = await pedido('Raro', '1x Algo que no existe', 'entregado');
const web = await pedido('Cliente Web', '1x Perfume 12\n1x Perfume 13', 'entregado', U1);
const webNuevo = await pedido('Cliente Web', '1x Perfume 14', 'confirmado', U1);

const enlace = async id => admin(async () => (await one(db, 'select public.admin_review_link($1) as r', [id])).r);
r = await enlace(nuevo);
assert(r.ok === false && /entregado/.test(r.message), 'Un pedido sin entregar no se puede calificar');
r = await enlace(raro);
assert(r.ok === false && /No reconocí perfumes/.test(r.message), 'Un pedido sin perfumes de la tienda tampoco');
assert.deepEqual(await enlace(999999), { ok: false, message: 'Ese pedido ya no existe.' });
r = await enlace(entregado);
assert(r.ok === true && /^[0-9a-f]{32}$/.test(r.token), 'El pedido entregado tiene su enlace (32 letras al azar)');
const token = r.token;
assert.equal((await enlace(entregado)).token, token, 'Pedirlo otra vez da el mismo enlace');
await cliente(U1, () => throws(() => db.query('select public.admin_review_link($1)', [entregado]), /Solo para administradores/, 'Un cliente no crea enlaces de otros pedidos'));
await anon(() => throws(() => db.query('select public.admin_review_link($1)', [entregado]), /permission denied/i, 'Un visitante tampoco'));

// «Mis pedidos»: solo el dueño y solo si ya se entregó.
const mio = async (user, id) => cliente(user, async () => (await one(db, 'select public.my_review_link($1) as r', [id])).r);
r = await mio(U1, web);
assert(r.ok === true && /^[0-9a-f]{32}$/.test(r.token), 'El cliente tiene el enlace de su pedido entregado');
const tokenWeb = r.token;
r = await mio(U1, webNuevo);
assert(r.ok === false && /cuando tu pedido esté entregado/.test(r.message), 'pero no de uno sin entregar');
r = await mio(U2, web);
assert(r.ok === false && /No encontramos ese pedido/.test(r.message), 'Nadie más puede pedir el enlace de ese pedido');
await anon(() => throws(() => db.query('select public.my_review_link($1)', [web]), /permission denied/i, 'Sin sesión no hay enlace'));

// La página de la reseña: el primer nombre y los perfumes del pedido (sin teléfono, dirección ni montos).
const invitacion = async t => anon(async () => (await one(db, 'select public.review_invite($1) as r', [t])).r);
r = await invitacion(token);
assert.deepEqual(r, { ok: true, first_name: 'María', products: [{ id: 10, name: 'Perfume 10', size: null, reviewed: false }, { id: 20, name: 'Perfume 20', size: null, reviewed: false }] },
  'Solo el primer nombre y los perfumes de la tienda del pedido');
assert.equal((await invitacion(token.toUpperCase())).ok, true, 'El enlace funciona aunque cambien mayúsculas');
for (const malo of ['', 'hola', '0'.repeat(32), token.slice(0, 31) + 'g', null]) {
  r = await invitacion(malo);
  assert(r.ok === false && /no es válido/.test(r.message), 'Enlace inválido: ' + malo);
}

const calificar = async (t, producto, estrellas, comentario, autor) => anon(async () => (await one(db, 'select public.submit_review($1, $2, $3, $4, $5) as r', [t, producto, estrellas, comentario, autor])).r);
await desde('203.0.0.1');
for (const [producto, estrellas, comentario, autor, patron, label] of [
  [10, 0, '', 'María P.', /de 1 a 5 estrellas/, 'Cero estrellas'],
  [10, 6, '', 'María P.', /de 1 a 5 estrellas/, 'Seis estrellas'],
  [10, null, '', 'María P.', /de 1 a 5 estrellas/, 'Sin estrellas'],
  [10, 5, '', 'M', /nombre con el que se verá/, 'Nombre muy corto'],
  [10, 5, '', '<i>María</i>', /nombre con el que se verá/, 'Nombre con código'],
  [10, 5, 'x'.repeat(601), 'María P.', /hasta 600 letras/, 'Comentario muy largo'],
  [10, 5, 'Cómpralo en www.otra.com', 'María P.', /enlaces/, 'Comentario con enlace'],
  [30, 5, '', 'María P.', /no es de este pedido/, 'Un perfume que no está en el pedido'],
]) { r = await calificar(token, producto, estrellas, comentario, autor); assert(r.ok === false && patron.test(r.message), label + ': ' + r.message); }
r = await calificar('f'.repeat(32), 10, 5, '', 'María P.');
assert(r.ok === false && /no es válido/.test(r.message), 'Sin un enlace válido no se califica');
assert.equal((await one(db, 'select count(*)::int as n from public.product_reviews')).n, 0, 'Nada inválido se guarda');

r = await calificar(token, 10, 5, '  Me encantó:\r\n\r\n\r\n dura todo el día. ', '  María   P. ');
assert.deepEqual(r, { ok: true, already: false, message: '¡Gracias! Publicaremos tu reseña cuando la revisemos.' }, 'Reseña válida');
r = await calificar(token, 10, 1, 'Cambié de opinión', 'María P.');
assert.deepEqual([r.ok, r.already], [true, true], 'Cada perfume de un pedido se califica una sola vez');
assert.equal((await calificar(token, 20, 4, '', 'María P.')).ok, true, 'El comentario es opcional');
assert.deepEqual((await invitacion(token)).products.map(p => p.reviewed), [true, true], 'La página sabe qué perfumes ya calificó');
assert.deepEqual((await db.query(`select product_id, order_id, author_name, rating, comment, status from public.product_reviews order by id`)).rows.map(x => ({ ...x, product_id: Number(x.product_id), order_id: Number(x.order_id) })), [
  { product_id: 10, order_id: entregado, author_name: 'María P.', rating: 5, comment: 'Me encantó:\n\ndura todo el día.', status: 'pendiente' },
  { product_id: 20, order_id: entregado, author_name: 'María P.', rating: 4, comment: '', status: 'pendiente' },
], 'Se guardan limpias y «pendientes»');
assert.equal((await calificar(tokenWeb, 12, 3, 'Bien', 'Cliente W.')).ok, true, 'El enlace de «Mis pedidos» también sirve');

// Lo que ve la tienda: nada hasta publicarla, y nunca el pedido, el estado ni la conexión.
const publicas = async () => anon(async () => (await db.query('select product_id, author_name, rating, comment from public.product_reviews order by id')).rows.map(x => ({ ...x, product_id: Number(x.product_id) })));
assert.deepEqual(await publicas(), [], 'Las reseñas «pendientes» no se ven');
await anon(async () => {
  for (const col of ['order_id', 'status', 'ip_hash', '*']) await throws(() => db.query('select ' + col + ' from public.product_reviews'), /permission denied/i, 'La tienda no puede leer ' + col);
  await throws(() => db.query(`select id from public.product_reviews where status = 'pendiente'`), /permission denied/i, 'Ni buscar por estado');
  await throws(() => db.query(`insert into public.product_reviews (product_id, author_name, rating) values (10, 'Falso', 5)`), /permission denied/i, 'Ni escribir reseñas sin enlace');
  await throws(() => db.query('select * from private.review_invites'), /permission denied/i, 'Ni ver los enlaces');
  await throws(() => db.query(`select private.review_token(1)`), /permission denied/i, 'Ni crear enlaces');
  await throws(() => db.query('select * from public.admin_reviews()'), /permission denied/i, 'Ni la lista del panel');
});
await cliente(U2, async () => {
  assert.equal((await db.query('select * from public.admin_reviews()')).rows.length, 0, 'Un cliente con cuenta no ve la lista del panel');
  await throws(() => db.query(`select public.admin_moderate_review(1, 'publicar')`), /Solo para administradores/, 'Ni publica reseñas');
  await throws(() => db.query(`update public.product_reviews set rating = 5`), /permission denied/i, 'Ni las cambia');
});

// Panel: lista, publicar, ocultar, volver a revisar y borrar (la web se publica sola solo cuando cambia algo visible).
const lista = await admin(async () => (await db.query('select * from public.admin_reviews()')).rows);
assert.deepEqual(lista.map(x => [x.product_name, Number(x.order_id), x.customer_name, x.status]),
  [['Perfume 12', web, 'Cliente Web', 'pendiente'], ['Perfume 20', entregado, 'maría josé pérez', 'pendiente'], ['Perfume 10', entregado, 'maría josé pérez', 'pendiente']],
  'El panel ve cada reseña con su perfume y su pedido');
const revisar = async (id, accion) => admin(async () => (await one(db, 'select public.admin_moderate_review($1, $2) as r', [id, accion])).r);
const publicaciones = async () => (await one(db, 'select count(*)::int as n from net.calls')).n;
const sinEspera = () => db.exec('update private.publish_state set last_request = null');
const [rWeb, r20, r10] = lista.map(x => Number(x.id));
await sinEspera(); let antes = await publicaciones();
assert.deepEqual(await revisar(r10, 'publicar'), { ok: true });
assert.equal(await publicaciones(), antes + 1, 'Publicar una reseña vuelve a publicar la web');
assert.deepEqual(await publicas(), [{ product_id: 10, author_name: 'María P.', rating: 5, comment: 'Me encantó:\n\ndura todo el día.' }], 'La tienda ve la publicada (solo nombre, estrellas y comentario)');
await sinEspera(); antes = await publicaciones();
assert.deepEqual(await revisar(r10, 'publicar'), { ok: true }, 'Publicarla otra vez no falla');
assert.deepEqual(await revisar(r20, 'ocultar'), { ok: true });
await anon(() => calificar(tokenWeb, 13, 5, 'Excelente', 'Cliente W.'));
assert.equal(await publicaciones(), antes, 'Ocultar una que no estaba publicada o recibir una nueva no publica la web');
assert.deepEqual(await revisar(r10, 'ocultar'), { ok: true });
assert.deepEqual(await publicas(), [], 'Ocultarla la quita de la tienda');
assert.equal(await publicaciones(), antes + 1, 'y vuelve a publicar la web');
assert.deepEqual(await revisar(r10, 'revisar'), { ok: true });
assert.equal((await one(db, 'select status from public.product_reviews where id = $1', [r10])).status, 'pendiente', 'Puede volver a «por revisar»');
await revisar(rWeb, 'publicar'); await sinEspera(); antes = await publicaciones();
assert.deepEqual(await revisar(rWeb, 'borrar'), { ok: true });
assert.equal(await publicaciones(), antes + 1, 'Borrar una publicada vuelve a publicar la web');
assert.deepEqual(await revisar(rWeb, 'borrar'), { ok: false, message: 'Esa reseña ya no existe.' });
assert.deepEqual(await revisar(r10, 'aprobar'), { ok: false, message: 'Acción desconocida.' });
await anon(() => throws(() => db.query(`select public.admin_moderate_review(1, 'publicar')`), /permission denied/i, 'Un visitante no revisa reseñas'));
console.log('reseñas verificadas OK');

// Enlaces que dejan de servir: vencido, pedido que ya no figura como entregado, perfume oculto y pedido borrado.
await db.exec(`update private.review_invites set expires_at = now() - interval '1 day' where order_id = ${entregado}`);
r = await invitacion(token);
assert(r.ok === false && /venció/.test(r.message), 'Un enlace vencido no sirve');
assert(/venció/.test((await calificar(token, 20, 5, '', 'María P.')).message), 'ni para calificar');
const nuevoToken = (await enlace(entregado)).token;
assert(nuevoToken !== token && (await invitacion(nuevoToken)).ok, 'El panel crea uno nuevo si el anterior venció');
await db.exec(`update private.review_invites set expires_at = now() + interval '2 days' where order_id = ${entregado}`);
await enlace(entregado);
assert((await one(db, `select expires_at > now() + interval '29 days' as ok from private.review_invites where order_id = ${entregado}`)).ok, 'Volver a mandarlo le da al menos 30 días más');
await db.exec(`update public.orders set status = 'enviado' where id = ${entregado}`);
assert(/todavía no figura como entregado/.test((await invitacion(nuevoToken)).message), 'Si el pedido vuelve atrás, el enlace se pausa');
await db.exec(`update public.orders set status = 'entregado' where id = ${entregado}`);
await db.exec(`update public.products set active = false where id = 20`);
assert.deepEqual((await invitacion(nuevoToken)).products.map(p => p.id), [10], 'Un perfume oculto no se ofrece para calificar');
await db.exec(`update public.products set active = true where id = 20`);
await revisar(r10, 'publicar');
await db.exec(`delete from public.orders where id = ${entregado}`);
assert.equal((await one(db, `select count(*)::int as n from private.review_invites where order_id = ${entregado}`)).n, 0, 'Borrar el pedido borra su enlace');
assert.deepEqual((await db.query(`select order_id, status from public.product_reviews where id = ${r10}`)).rows, [{ order_id: null, status: 'aprobada' }], 'pero sus reseñas se quedan');

// Límites: 20 reseñas por hora por conexión y 300 por hora en total.
const otro = await pedido('Lucía', '1x Perfume 15\n1x Perfume 16', 'entregado');
const tokenOtro = (await enlace(otro)).token;
await desde('204.0.0.1');
const huella = (await one(db, 'select private.request_ip_hash() as h')).h;
await db.exec(`insert into public.product_reviews (product_id, author_name, rating, ip_hash) select 1, 'Bot', 5, '${huella}' from generate_series(1, 20)`);
r = await calificar(tokenOtro, 15, 5, '', 'Lucía');
assert(r.ok === false && /muchas reseñas seguidas/.test(r.message), 'Máximo 20 reseñas por hora desde la misma conexión');
await db.exec(`delete from public.product_reviews where author_name = 'Bot'`);
await db.exec(`insert into public.product_reviews (product_id, author_name, rating) select 1, 'Bot', 5 from generate_series(1, 300)`);
await desde('204.0.0.2');
r = await calificar(tokenOtro, 15, 5, '', 'Lucía');
assert(r.ok === false && /no podemos recibir más reseñas/.test(r.message), 'Máximo 300 reseñas por hora en total');
await db.exec(`delete from public.product_reviews where author_name = 'Bot'`);
await db.exec(`update public.product_reviews set ip_hash = 'vieja', created_at = now() - interval '8 days' where id = ${r20}`);
assert.equal((await calificar(tokenOtro, 15, 5, '', 'Lucía')).ok, true);
assert.equal((await one(db, `select ip_hash from public.product_reviews where id = ${r20}`)).ip_hash, null, 'La huella de conexión se borra a los 7 días');
console.log('enlaces y límites de las reseñas OK');

// ---------------------------------------------------------------- Repetir, deshacer y volver a aplicar
const contar = async () => one(db, 'select (select count(*)::int from public.contact_messages) as m, (select count(*)::int from public.product_reviews) as r, (select count(*)::int from private.review_invites) as i');
const antesRep = await contar();
res = (await db.exec(script)).at(-1).rows;
assert.deepEqual(await contar(), antesRep, 'Repetirlo no borra ni duplica nada');
assert.match(res[1].estado, /^listas: .*\(1 publicadas, \d+ por revisar\)$/, 'Resumen al repetir');
const pedidosAntes = (await one(db, 'select count(*)::int as n from public.orders')).n;
res = (await db.exec(script.replace('select false as deshacer;', 'select true as deshacer;'))).at(-1).rows;
assert.deepEqual(res.map(x => x.estado), ['quitados', 'quitadas', 'quitada'], 'Deshacer');
for (const t of ['public.contact_messages', 'public.product_reviews', 'private.review_invites']) assert.equal((await one(db, 'select to_regclass($1) as t', [t])).t, null, 'Se quita ' + t);
assert.equal((await one(db, `select count(*)::int as n from pg_proc where proname in ('send_contact_message', 'submit_review', 'review_invite', 'admin_reviews', 'admin_moderate_review', 'admin_review_link', 'my_review_link', 'review_token', 'review_order', 'review_products', 'clean_text')`)).n, 0, 'Y sus funciones');
assert.equal((await one(db, 'select count(*)::int as n from public.orders')).n, pedidosAntes, 'Los pedidos no se tocan');
res = (await db.exec(script)).at(-1).rows;
assert.match(res[0].estado, /^listos/, 'Se puede volver a aplicar');
// Pegado incompleto: no cambia nada.
{
  const limpio = await base();
  await throws(() => limpio.exec(script.slice(0, Math.floor(script.length * 0.6))), /./, 'Un pegado incompleto da error');
  assert.equal((await one(limpio, `select to_regclass('public.contact_messages') as t`)).t, null, 'y no deja nada a medias');
  await limpio.close();
}
await db.close();
console.log('repetir, deshacer y pegado incompleto OK');
console.log('TODAS LAS PRUEBAS DE MENSAJES Y RESEÑAS PASARON');
