// Prueba de 20261110200000_dos_precios.sql con PostgreSQL embebido (PGlite): NO toca Supabase ni necesita claves.
// Sobre la tienda de prueba (septiembre, octubre y líneas de pedido aplicados) comprueba: el pedido a dos pagos y el de
// contado (total calculado en la base con el mismo precio de contado que muestra la página, sin descuento en ofertas),
// que el cupón no se combina con contado, que un visitante sin sesión no puede usarlo, la subida de 4 precios (respeta
// lo cambiado a mano y avisa), repetir sin duplicar y deshacer.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-dos-precios-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const PAGOS_SRC = await readFile('pagos.js', 'utf8');
const PAGOS = (() => { const ctx = {}; new Function('self', PAGOS_SRC)(ctx); return ctx.ElitePagos; })();
const M = 'supabase/migrations/';
const [script, sep30, oct16, lineas] = await Promise.all([M + '20261110200000_dos_precios.sql', M + '20260930120000_funciones_y_perfumes_nuevos.sql',
  M + '20261016120000_catalogo_la_grada_octubre.sql', M + '20261003180000_lineas_de_pedido_y_existencias.sql'].map(f => readFile(f, 'utf8')));
const CAMBIOS = [[295, 'Moschino Toy Boy', 'RD$5,250', 'RD$5,450'], [327, 'Rayhaan Elixir', 'RD$3,550', 'RD$4,950'],
  [369, 'Set De Asad Bourbon', 'RD$3,850', 'RD$3,950'], [456, 'Rayhaan Tropical Vibe', 'RD$4,450', 'RD$4,950']];

// ---------------------------------------------------------------- El archivo (público: nunca costos ni la fórmula)
{
  const code = script.replace(/--[^\n]*/g, '');
  assert(/^-- DOS PRECIOS: CONTADO Y A DOS PAGOS/.test(script) && /-- FIN\s*$/.test(script), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(/create temp table modo on commit drop as select false as deshacer;/.test(script), 'Queda en modo aplicar');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios (se puede correr desde GitHub)');
  assert(!/product_costs|pricing|costo/i.test(code), 'No trae costos ni la fórmula de precios');
  for (const [id, nombre, antes, ahora] of CAMBIOS) assert(script.includes(`(${id}, '${nombre}', '${antes}', '${ahora}')`), nombre);
  const turno = code.indexOf('lock table public.products in share row exclusive mode nowait');
  assert(turno > 0 && turno < code.indexOf('update public.products'), 'Aparta los perfumes antes del primer cambio');
}

const U1 = '11111111-1111-1111-1111-111111111111';
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const aplicar = async (db, sql = script) => (await db.exec(sql)).at(-1).rows;
const fila = (rows, texto) => rows.find(r => r.cambio.includes(texto));
const avisos = rows => rows.filter(r => r.cambio.startsWith('No se tocó'));
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
const DESHACER = script.replace('select false as deshacer;', 'select true as deshacer;');
const num = text => Number(String(text).replace(/[^0-9]/g, ''));

// La tienda de hoy, con un place_customer_order como el de Supabase: valida la sesión, lee el precio de la base y escribe
// el pedido como «2x Nombre».
async function base() {
  const db = await nuevaBase(PGlite);
  await db.exec(sep30); await db.exec(oct16); await db.exec(lineas);
  for (const [id, nombre, antes] of CAMBIOS) await db.query('update public.products set name = $2, price = $3, original_price = null where id = $1', [id, nombre, antes]);
  await db.exec(`update public.products set name = 'Rasasi Hawas Fire Men', price = 'RD$4,450', size = '100 ML' where id = 324;
    update public.products set name = 'Armaf Odyssey Homme White', price = 'RD$3,550 / RD$4,250', size = '100 / 200 ML' where id = 71;
    update public.products set name = 'Perfume en oferta', price = 'RD$2,990', original_price = 'RD$3,450', offer_label = 'Oferta' where id = 50;
    insert into auth.users (id) values ('${U1}');
    create or replace function public.place_customer_order(p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $f$
    declare v_txt text := ''; v_total numeric := 0; it jsonb; p public.products; v_id bigint; v_i smallint;
    begin
      if auth.uid() is null then raise exception 'Debes iniciar sesión para ordenar.'; end if;
      for it in select * from jsonb_array_elements(p_items) loop
        select * into p from public.products where id = (it ->> 'product_id')::bigint and active;
        if p.id is null then raise exception 'Uno de los productos ya no está disponible.'; end if;
        v_i := coalesce(private.size_index(p.size, it ->> 'size'), 0);
        v_total := v_total + private.price_at(p.price, v_i) * (it ->> 'qty')::int;
        v_txt := v_txt || (it ->> 'qty') || 'x ' || p.name || case when coalesce(it ->> 'size', '') <> '' then ' (' || (it ->> 'size') || ')' else '' end || E'\\n';
      end loop;
      insert into public.orders (customer_name, phone, items, amount, user_id, notes)
        values ('Cliente', '8095550000', btrim(v_txt, E'\\n'), 'RD$' || to_char(v_total, 'FM999,999,999'), auth.uid(), 'Pedido web.') returning id into v_id;
      return jsonb_build_object('order_id', v_id);
    end $f$;
    revoke execute on function public.place_customer_order(jsonb) from public, anon;
    grant execute on function public.place_customer_order(jsonb) to authenticated;`);
  return db;
}
const asUser = async (db, id) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id || '']); await db.exec('set role authenticated'); };
const asAnon = async db => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); await db.exec('set role anon'); };
const pedir = async (db, items, plan, coupon = null) => (await db.query('select public.place_customer_order_pago($1::jsonb, $2, $3) as r', [JSON.stringify(items), coupon, plan])).rows[0].r;
const orden = async (db, id) => { await db.exec('reset role'); const o = await one(db, 'select amount, payment_plan, notes from public.orders where id = $1', [id]); return o; };

// ---------------------------------------------------------------- El precio de contado de la base = el de la página
{
  const db = await base();
  await aplicar(db);
  for (let v = 1000; v <= 40000; v += 50) {
    const r = await one(db, 'select private.precio_contado($1)::int as c', [v]);
    assert.equal(r.c, PAGOS.contado(v), 'Contado de RD$' + v);
  }
  assert.equal(PAGOS.contado(4450), 4050); assert.equal(PAGOS.contado(3050), 2750); assert.equal(PAGOS.cuota(4450), 2225);
  assert.equal(PAGOS.planes({ price: 'RD$4,450' }), '2 pagos de RD$2,225 · Contado RD$4,050');
  assert.equal(PAGOS.planes({ price: 'RD$3,550 / RD$4,250' }), 'A dos pagos o Contado RD$3,150 / RD$3,850');
  assert.equal(PAGOS.planes({ price: 'RD$2,990', original_price: 'RD$3,450' }), '', 'En oferta no hay precio de contado aparte');
  assert.equal(PAGOS.totalCarrito([{ unit_price: 4450, qty: 2 }, { unit_price: 2990, qty: 1, offer: true }], 'contado'), 4050 * 2 + 2990);
  assert.equal(PAGOS.totalCarrito([{ unit_price: 4450, qty: 2 }], 'dos_pagos'), 8900);
  await db.close();
}
console.log('precio de contado: la base y la página dan lo mismo OK');

// ---------------------------------------------------------------- Aplicar, pedidos y repetir
{
  const db = await base();
  let res = await aplicar(db);
  assert.equal(Number(fila(res, 'Precios que suben').hechos_ahora), 4); assert.deepEqual(avisos(res), []);
  for (const [id, , , ahora] of CAMBIOS) assert.equal((await one(db, 'select price from public.products where id = $1', [id])).price, ahora);

  await asUser(db, U1);
  let r = await pedir(db, [{ product_id: 324, qty: 2, size: '100 ML' }], 'dos_pagos');
  let o = await orden(db, r.order_id);
  assert.equal(r.pago, 'dos_pagos'); assert.equal(Number(r.total), 8900); assert.equal(o.amount, 'RD$8,900'); assert.equal(o.payment_plan, 'dos_pagos');
  assert.match(o.notes, /A DOS PAGOS: RD\$4,450 al recibir y RD\$4,450 en 15 días/);

  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 2, size: '100 ML' }, { product_id: 71, qty: 1, size: '200 ML' }, { product_id: 50, qty: 1 }], 'contado');
  o = await orden(db, r.order_id);
  const esperado = PAGOS.contado(4450) * 2 + PAGOS.contado(4250) + 2990;
  assert.equal(Number(r.total), esperado, 'Contado: 10% menos en cada perfume, nada en el de oferta');
  assert.equal(num(o.amount), esperado); assert.equal(o.payment_plan, 'contado');
  assert.match(o.notes, /Pago de CONTADO: RD\$[0-9,]+ \(a dos pagos sería RD\$16,140\)/);

  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 1 }], 'contado', 'BIENVENIDA');
  assert.equal(r.ok, false); assert.match(r.message, /cupones son para compras a dos pagos/);
  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 1 }], 'dos_pagos', 'NOEXISTE');
  assert.equal(r.ok, false, 'Un cupón que no existe no registra el pedido');
  await asUser(db, U1);
  await throws(() => pedir(db, [{ product_id: 324, qty: 1 }], 'fiado'), /forma de pago/, 'Forma de pago desconocida');
  await asAnon(db);
  await throws(() => pedir(db, [{ product_id: 324, qty: 1 }], 'contado'), /permission denied/i, 'Un visitante sin sesión no puede pedir');
  await db.exec('reset role');

  // Un perfume que la base no reconoce en el texto del pedido: queda al total de siempre y se avisa a la tienda.
  await db.exec(`update public.products set name = 'Hawas Fire (Edición)' where id = 324`);
  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 1 }], 'contado');
  o = await orden(db, r.order_id);
  assert.equal(o.payment_plan, 'contado'); assert.match(o.notes, /confirma el precio de contado/);
  await db.exec(`update public.products set name = 'Rasasi Hawas Fire Men' where id = 324`);

  res = await aplicar(db);
  assert.equal(Number(fila(res, 'Precios que suben').hechos_ahora), 0, 'Repetirlo no cambia nada'); assert.equal(Number(fila(res, 'Precios que suben').ya_estaban), 4);
  assert.deepEqual(avisos(res), []);

  // Deshacer: precios de antes y sin la función (la página usa la de siempre).
  res = await aplicar(db, DESHACER);
  assert.equal(Number(fila(res, 'devueltos').hechos_ahora), 4);
  for (const [id, , antes] of CAMBIOS) assert.equal((await one(db, 'select price from public.products where id = $1', [id])).price, antes);
  assert.equal((await one(db, `select to_regprocedure('public.place_customer_order_pago(jsonb,text,text)') as f`)).f, null);
  assert.equal((await one(db, `select count(*)::int as n from public.orders where payment_plan is not null`)).n, 3, 'Lo ya anotado se queda');
  res = await aplicar(db);
  assert.equal(Number(fila(res, 'Precios que suben').hechos_ahora), 4, 'Se puede volver a aplicar');
  await db.close();
}
console.log('pedidos a dos pagos y de contado, cupones, sesión, repetir y deshacer OK');

// ---------------------------------------------------------------- Lo cambiado a mano en el panel se respeta
{
  const db = await base();
  await db.query(`update public.products set price = 'RD$9,999' where id = 327`);
  const res = await aplicar(db);
  assert.equal(Number(fila(res, 'Precios que suben').hechos_ahora), 3);
  assert.equal((await one(db, 'select price from public.products where id = 327')).price, 'RD$9,999');
  const lista = avisos(res).map(r => r.cambio);
  assert.equal(lista.length, 1); assert.match(lista[0], /#327 .*RD\$9,999.*RD\$3,550/);
  await db.close();
}
console.log('precio cambiado a mano: se respeta y se avisa OK');
console.log('DOS PRECIOS: TODO OK');
