// Prueba de 20261110230000_contado_con_cupon.sql con PostgreSQL embebido (PGlite): NO toca Supabase ni necesita claves.
// Sobre la tienda de prueba con 20261110200000_dos_precios.sql aplicado comprueba el pedido de la web a precio de contado:
// sin cupón, con cupón (el descuento se calcula sobre el total de contado, queda anotado y cuenta como uso del cupón), un
// cupón que no existe (no registra nada), que un visitante sin sesión no puede usarlo y que «a dos pagos» sigue igual.
//   npm install --no-save @electric-sql/pglite
//   node scripts/test-contado-con-cupon-sql.mjs
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas de base de datos. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const PAGOS_SRC = await readFile('pagos.js', 'utf8');
const PAGOS = (() => { const ctx = {}; new Function('self', PAGOS_SRC)(ctx); return ctx.ElitePagos; })();
const M = 'supabase/migrations/';
const [script, dosPrecios, sep30, oct16, lineas] = await Promise.all([M + '20261110230000_contado_con_cupon.sql', M + '20261110200000_dos_precios.sql',
  M + '20260930120000_funciones_y_perfumes_nuevos.sql', M + '20261016120000_catalogo_la_grada_octubre.sql', M + '20261003180000_lineas_de_pedido_y_existencias.sql'].map(f => readFile(f, 'utf8')));
const CAMBIOS = [[295, 'Moschino Toy Boy', 'RD$5,250', 'RD$5,450'], [327, 'Rayhaan Elixir', 'RD$3,550', 'RD$4,950'],
  [369, 'Set De Asad Bourbon', 'RD$3,850', 'RD$3,950'], [456, 'Rayhaan Tropical Vibe', 'RD$4,450', 'RD$4,950']];

{
  const code = script.replace(/--[^\n]*/g, '');
  assert(/^-- PRECIO DE CONTADO EN LA WEB/.test(script) && /-- FIN\s*$/.test(script), 'Empieza y termina con las marcas para comprobar el pegado');
  assert(!/^\s*(begin|commit|rollback)\s*;/im.test(code), 'Sin BEGIN/COMMIT propios');
  assert(!/product_costs|pricing|costo/i.test(code), 'No trae costos');
}

const U1 = '11111111-1111-1111-1111-111111111111';
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const aplicar = async (db, sql = script) => (await db.exec(sql)).at(-1).rows;
const fila = (rows, texto) => rows.find(r => r.cambio.includes(texto));
const avisos = rows => rows.filter(r => r.cambio.startsWith('No se tocó'));
const throws = async (fn, pattern, label) => { try { await fn(); } catch (e) { assert.match(String(e.message), pattern, label); return; } assert.fail('Debía fallar: ' + label); };
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


const base2 = async () => { const db = await base(); await db.exec(dosPrecios); await db.exec(script);
  await db.exec(`insert into public.coupons (code, description, kind, value) values ('PRUEBA10', 'Prueba', 'percent', 10)`); return db; };

{
  const db = await base2();
  await asUser(db, U1);
  let r = await pedir(db, [{ product_id: 324, qty: 2, size: '100 ML' }, { product_id: 50, qty: 1 }], 'contado');
  let o = await orden(db, r.order_id);
  const contado = PAGOS.contado(4450) * 2 + 2990;
  assert.equal(Number(r.total), contado, 'Contado: 10% menos en cada perfume, nada en el de oferta'); assert.equal(num(o.amount), contado); assert.equal(o.payment_plan, 'contado');
  assert.match(o.notes, /CONTADO: RD\$[0-9,]+ \(a dos pagos sería RD\$11,890\)/);

  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 2, size: '100 ML' }], 'contado', 'prueba10');
  o = await orden(db, r.order_id);
  const sub = PAGOS.contado(4450) * 2, desc = Math.round(sub * 0.10);
  assert.equal(Number(r.subtotal), sub); assert.equal(Number(r.descuento), desc, 'El cupón se calcula sobre el total de contado'); assert.equal(Number(r.total), sub - desc);
  assert.equal(r.cupon, 'PRUEBA10'); assert.equal(num(o.amount), sub - desc); assert.match(o.notes, /cupón PRUEBA10/);
  const used = await one(db, `select used_count, (select count(*)::int from public.coupon_redemptions where coupon_code = 'PRUEBA10') as n from public.coupons where code = 'PRUEBA10'`);
  assert.equal(used.used_count, 1); assert.equal(used.n, 1);
  const pedidos = (await one(db, 'select count(*)::int as n from public.orders')).n;

  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 1 }], 'contado', 'NOEXISTE');
  assert.equal(r.ok, false, 'Un cupón que no existe no registra el pedido');
  await db.exec('reset role');
  assert.equal((await one(db, 'select count(*)::int as n from public.orders')).n, pedidos, 'y no queda pedido a medias');

  await asUser(db, U1);
  r = await pedir(db, [{ product_id: 324, qty: 1 }], 'dos_pagos');
  o = await orden(db, r.order_id);
  assert.equal(o.payment_plan, 'dos_pagos'); assert.equal(o.amount, 'RD$4,450');

  await asAnon(db);
  await throws(() => pedir(db, [{ product_id: 324, qty: 1 }], 'contado'), /permission denied/i, 'Un visitante sin sesión no puede pedir');
  await db.exec('reset role');
  await db.exec(script);
  await db.close();
}
console.log('PRECIO DE CONTADO EN LA WEB (con y sin cupón): TODO OK');
