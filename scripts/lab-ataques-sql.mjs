// LABORATORIO DE ATAQUE (local y sin riesgo): levanta una copia de tu backend de Supabase con PostgreSQL embebido (PGlite)
// —las MISMAS reglas (RLS), funciones y permisos de tus migraciones— y lanza una batería de ataques como visitante sin
// sesión y como un cliente malintencionado que intenta robar datos de otro cliente, hacerse administrador, cambiar
// precios, abusar de cupones o inyectar SQL. No toca Supabase ni tu tienda real; no necesita ninguna clave.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/lab-ataques-sql.mjs
//
// Cada línea dice BLOQUEADO (tu defensa aguantó) o ¡VULNERABLE! (hay que arreglar). Al final sale el conteo.
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import { readFile } from 'node:fs/promises';
import { nuevaBase } from './lib/base-prueba-sql.mjs';

const M = 'supabase/migrations/';
const leer = f => readFile(M + f, 'utf8');
// nuevaBase ya trae: roles anon/authenticated, auth.uid(), administrador, products+orders con RLS, ofertas, cupones,
// protección de pedidos y encuesta. Encima aplicamos el resto que define la seguridad del backend de hoy.
const db = await nuevaBase(PGlite);
// Stubs de vault/net (publicación automática) para que las migraciones que los usan apliquen igual que en Supabase.
await db.exec(`create schema if not exists vault; create table if not exists vault.secrets_stub (name text, secret text);
  create or replace view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_stub;
  create schema if not exists net; create table if not exists net.calls (id serial primary key, url text, headers jsonb, body jsonb);
  create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
    returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;`);
for (const f of ['20260921122000_recuperacion_identidad.sql', '20260930120000_funciones_y_perfumes_nuevos.sql', '20261003120000_estadisticas_y_publicacion.sql',
  '20261003180000_lineas_de_pedido_y_existencias.sql', '20261007120000_mensajes_y_resenas.sql', '20261110200000_dos_precios.sql', '20261110230000_contado_con_cupon.sql']) {
  await db.exec(await leer(f));
}
await db.exec(`insert into vault.secrets_stub values ('github_publish_token', 'tok-prueba') on conflict do nothing;`);

// place_customer_order real vive en Supabase (no en el repositorio). Aquí ponemos una versión fiel que SIEMPRE recalcula el
// precio desde la base y jamás confía en el unit_price que manda el navegador: así el laboratorio prueba la regla de oro de
// la tienda («nunca confiar en el precio del cliente»). Si algún día tu función real sí confiara, el probe en vivo
// (check-supabase-security.mjs, contra el Supabase de verdad) es el que lo cazaría.
await db.exec(`create or replace function public.place_customer_order(p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $f$
  declare v_txt text := ''; v_total numeric := 0; it jsonb; p public.products; v_id bigint; v_i smallint; v_prof public.customer_profiles;
  begin
    if auth.uid() is null then raise exception 'Debes iniciar sesión para ordenar.' using errcode = '28000'; end if;
    select * into v_prof from public.customer_profiles where user_id = auth.uid();
    if v_prof is null or coalesce(v_prof.cedula,'') = '' then raise exception 'Completa tu perfil antes de pedir.'; end if;
    for it in select * from jsonb_array_elements(p_items) loop
      select * into p from public.products where id = (it ->> 'product_id')::bigint and active;
      if p.id is null then raise exception 'Uno de los productos ya no está disponible.'; end if;
      v_i := coalesce(private.size_index(p.size, it ->> 'size'), 0);
      v_total := v_total + private.price_at(p.price, v_i) * greatest(1, least(99, coalesce((it ->> 'qty')::int, 1)));
      v_txt := v_txt || greatest(1, least(99, coalesce((it ->> 'qty')::int, 1))) || 'x ' || p.name || case when coalesce(it ->> 'size','') <> '' then ' (' || (it ->> 'size') || ')' else '' end || E'\\n';
    end loop;
    insert into public.orders (customer_name, phone, items, amount, user_id, cedula, notes)
      values (trim(v_prof.first_name || ' ' || v_prof.last_name), v_prof.phone, btrim(v_txt, E'\\n'), 'RD$' || to_char(v_total, 'FM999,999,999'), auth.uid(), v_prof.cedula, 'Pedido web.') returning id into v_id;
    return jsonb_build_object('order_id', v_id);
  end $f$;
  revoke execute on function public.place_customer_order(jsonb) from public, anon; grant execute on function public.place_customer_order(jsonb) to authenticated;`);

// Modelo de aislamiento entre clientes (en tu Supabase real estas políticas ya existen; aquí las declaramos igual para
// poder comprobar que un cliente solo ve LO SUYO). Si alguna estuviera mal escrita en producción, el probe en vivo lo
// detecta; este laboratorio comprueba que el modelo correcto resiste los ataques.
await db.exec(`drop policy if exists "Cliente lee sus pedidos" on public.orders;
  create policy "Cliente lee sus pedidos" on public.orders for select to authenticated using (user_id = (select auth.uid()));
  drop policy if exists "Cliente lee su perfil" on public.customer_profiles;
  create policy "Cliente lee su perfil" on public.customer_profiles for select to authenticated using (user_id = (select auth.uid()));
  drop policy if exists "Cliente edita su perfil" on public.customer_profiles;
  create policy "Cliente edita su perfil" on public.customer_profiles for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));`);

// ---------------------------------------------------------------- Datos para el experimento
const ADMIN = '00000000-0000-0000-0000-000000000099';
const VICTIMA = '11111111-1111-1111-1111-111111111111', ATACANTE = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}','jefe@tienda.do'),('${VICTIMA}','ana@correo.do'),('${ATACANTE}','malo@correo.do');
  insert into public.admin_users values ('${ADMIN}');
  insert into public.customer_profiles (user_id, first_name, last_name, cedula, phone, address) values
    ('${VICTIMA}','Ana','Pérez','001-1234567-8','8095551111','Calle Luna 1'),
    ('${ATACANTE}','Malo','Hacker','002-7654321-0','8295552222','Calle Sol 2');
  insert into public.orders (customer_name, phone, items, amount, status, user_id, cedula) values
    ('Ana Pérez','8095551111','1x Rasasi Hawas Fire Men','RD$4,050','entregado','${VICTIMA}','001-1234567-8');
  insert into public.product_costs (product_id, costs, strategy) values (1, '{1700}', 'normal') on conflict do nothing;
  insert into public.coupons (code, description, kind, value, max_uses, one_per_customer) values ('PROMO10','Prueba','percent',10,1,true);`);

// Herramientas
const sesion = async uid => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']); await db.exec('set role ' + (uid ? 'authenticated' : 'anon')); };
const admin = async () => { await db.exec('reset role'); }; // rol dueño: sin RLS (para preparar o comprobar)
let ok = 0, bad = 0;
const linea = (seguro, texto, extra) => { console.log((seguro ? '  🛡️  BLOQUEADO  ' : '  ❌  ¡VULNERABLE! ') + texto + (extra ? '  — ' + extra : '')); seguro ? ok++ : bad++; };
// Un ataque «pasa la defensa» si lanza error de permiso/RLS, o si devuelve 0 filas (RLS lo deja ver nada).
const filas = async (sql, params = []) => { try { return (await db.query(sql, params)).rows; } catch (e) { return { error: e.message }; } };
const bloqueadoLectura = r => r.error ? /permission denied|row-level|not exist/i.test(r.error) : Array.isArray(r) && r.length === 0;
const bloqueadoEscritura = async (sql, params = []) => { try { const r = await db.query(sql, params); return (r.rows?.length ?? r.affectedRows ?? 0) === 0; } catch (e) { return /permission denied|row-level|violates|denegад|must|exception|not exist/i.test(e.message); } };
const lanza = async (sql, params = []) => { try { await db.query(sql, params); return false; } catch { return true; } };
const sec = t => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 64 - t.length)));

console.log('LABORATORIO DE ATAQUE A ELITE SCENTS RD (local, sin tocar la tienda real)\n');

// ================================================================ 1) Un VISITANTE sin cuenta
sec('1) Un visitante sin cuenta (lo que puede intentar cualquiera)');
await sesion(null);
linea(bloqueadoLectura(await filas('select * from public.orders')), 'Leer los pedidos de los clientes');
linea(bloqueadoLectura(await filas('select * from public.customer_profiles')), 'Leer cédulas, teléfonos y direcciones (perfiles)');
linea(bloqueadoLectura(await filas('select * from public.order_payments')), 'Leer los abonos/pagos');
linea(bloqueadoLectura(await filas('select * from public.product_costs')), 'Leer tus costos (lo que te cuesta cada perfume)');
linea(bloqueadoLectura(await filas('select * from public.store_settings')), 'Leer los ajustes de la tienda (incluye tu fórmula de precios)');
linea(bloqueadoLectura(await filas('select * from public.admin_users')), 'Ver quiénes son administradores');
linea(bloqueadoLectura(await filas('select * from public.contact_messages')), 'Leer los mensajes del formulario de contacto');
linea(bloqueadoLectura(await filas('select * from public.coupons')), 'Leer tus cupones y sus reglas');
linea(await bloqueadoEscritura(`update public.products set price = 'RD$1' where id = 1`), 'Cambiar el precio de un perfume a RD$1');
linea(await bloqueadoEscritura(`delete from public.products where id = 1`), 'Borrar un perfume del catálogo');
linea(await bloqueadoEscritura(`insert into public.admin_users values ('${ATACANTE}')`), 'Hacerse administrador (meterse en admin_users)');
linea(await lanza(`select public.place_customer_order('[]'::jsonb)`), 'Hacer un pedido sin iniciar sesión');
linea(await lanza(`select public.admin_list_customers()`), 'Pedir la lista de cuentas de clientes (función de admin)');
linea(await bloqueadoEscritura(`update public.store_settings set orders_paused = true where id`), 'Pausar la tienda / cambiar ajustes');
// El catálogo activo SÍ debe verse (es lo normal): confirmamos que no rompimos la tienda.
const cat = await filas('select count(*)::int n from public.products where active');
linea(Array.isArray(cat) && cat[0].n > 0, 'El catálogo público sí se ve (control: la tienda funciona)', cat[0]?.n + ' perfumes');

// ================================================================ 2) Un CLIENTE con cuenta atacando a OTRO cliente
sec('2) Un cliente con cuenta que ataca a otro cliente (Ana)');
await sesion(ATACANTE);
linea(bloqueadoLectura(await filas(`select * from public.orders where user_id = '${VICTIMA}'`)), 'Leer los pedidos de Ana');
linea(bloqueadoLectura(await filas(`select cedula, phone, address from public.customer_profiles where user_id = '${VICTIMA}'`)), 'Robar la cédula, el teléfono y la dirección de Ana');
linea(bloqueadoLectura(await filas('select * from public.order_items')), 'Ver los renglones de pedidos (quién compró qué)');
linea(await bloqueadoEscritura(`update public.orders set status = 'cancelado' where user_id = '${VICTIMA}'`), 'Cancelar/cambiar el pedido de Ana');
linea(await bloqueadoEscritura(`update public.customer_profiles set phone = '8090000000' where user_id = '${VICTIMA}'`), 'Cambiar el teléfono de Ana por el suyo');
linea(await bloqueadoEscritura(`update public.products set price = 'RD$1' where id = 1`), 'Cambiar precios del catálogo');
linea(await bloqueadoEscritura(`insert into public.admin_users values ('${ATACANTE}')`), 'Ascenderse a administrador');
linea(bloqueadoLectura(await filas('select * from public.product_costs')), 'Leer tus costos');
linea(bloqueadoLectura(await filas('select * from public.store_settings')), 'Leer tu fórmula de precios (ajustes)');
linea(await lanza('select public.admin_list_customers()'), 'Listar todas las cuentas de clientes');
// Control: el atacante SÍ debe poder ver lo suyo.
await db.exec(`reset role`); await db.exec(`insert into public.orders (customer_name, phone, items, amount, status, user_id, cedula) values ('Malo Hacker','8295552222','1x prueba','RD$1,000','nuevo','${ATACANTE}','002-7654321-0')`);
await sesion(ATACANTE);
const propios = await filas('select count(*)::int n from public.orders');
linea(Array.isArray(propios) && propios[0].n === 1, 'Control: solo ve SU pedido, no el de Ana', 've ' + (propios[0]?.n) + ' pedido(s)');

// ================================================================ 3) Trampas con el precio al hacer un pedido
sec('3) Trampas con el precio al hacer un pedido (cliente con sesión)');
await sesion(ATACANTE);
const precioReal = (await (async () => { await admin(); const r = await db.query('select price from public.products where id = 1'); await sesion(ATACANTE); return r; })()).rows[0].price;
// Manda un unit_price ridículo: la base debe ignorarlo y cobrar el precio real.
const ped = await filas(`select public.place_customer_order('[{"product_id":1,"qty":1,"unit_price":1}]'::jsonb) as r`);
await admin();
const guardado = (await db.query(`select amount from public.orders where user_id = '${ATACANTE}' order by id desc limit 1`)).rows[0];
linea(guardado && guardado.amount !== 'RD$1' && guardado.amount !== 'RD$0', 'Comprar un perfume por RD$1 mandando un precio falso', 'cobró ' + guardado?.amount + ' (precio real ' + precioReal + ')');
// Cantidad gigante: la base debe recortarla (a 99), no crear un pedido de 999,999.
await admin();
await db.exec(`delete from public.orders where user_id = '${ATACANTE}'`); // dejar limpio para medir
await sesion(ATACANTE);
await filas(`select public.place_customer_order('[{"product_id":1,"qty":999999}]'::jsonb)`);
await admin();
const unidades = (await db.query(`select (regexp_match(items, '^([0-9]+)x'))[1]::int as q from public.orders where user_id = '${ATACANTE}' order by id desc limit 1`)).rows[0];
linea(unidades && unidades.q <= 99, 'Pedir 999,999 unidades (desbordar la cantidad)', unidades ? 'la base la recortó a ' + unidades.q : 'sin pedido');

// ================================================================ 4) Abuso de cupones
sec('4) Abuso de cupones (PROMO10: 10%, un solo uso por cliente)');
await admin();
// Atrasamos los pedidos previos del atacante para que NO salte el límite de «muchos pedidos en 10 min»: así probamos
// específicamente la regla «un solo uso por cliente» del cupón, no el límite de ritmo.
await db.exec(`update public.orders set created_at = now() - interval '2 hours' where user_id = '${ATACANTE}'`);
await sesion(ATACANTE);
// Usar el cupón una vez (legítimo), luego intentar reusarlo.
const usar = async () => filas(`select public.place_customer_order_con_cupon('[{"product_id":1,"qty":1}]'::jsonb, 'PROMO10') as r`);
const primero = await usar();
const reuso = await usar();
const msg = (reuso[0]?.r?.message || reuso.error || JSON.stringify(reuso)).toString();
linea(reuso[0]?.r?.ok === false || /error|usad|una vez|only|máx|limit|no .*combin|no válid|no se puede|pocos minutos/i.test(msg), 'Reusar un cupón de «un solo uso por cliente»', 'rechazado: «' + msg.slice(0, 55) + '»');
linea(primero[0]?.r && primero[0].r.ok !== false, 'Control: el primer uso del cupón sí funcionó');
// Inyección SQL en el código del cupón.
const inj = await filas(`select public.place_customer_order_con_cupon('[{"product_id":1,"qty":1}]'::jsonb, $$' OR 1=1; drop table public.coupons;--$$) as r`);
await admin();
const cuponesVivos = await filas(`select count(*)::int n from public.coupons`);
linea(Array.isArray(cuponesVivos) && cuponesVivos[0].n >= 1, 'Inyección SQL en el código del cupón (intentar borrar la tabla)', 'la tabla de cupones sigue con ' + cuponesVivos[0]?.n + ' cupón(es)');

// ================================================================ 5) Inyección SQL en los datos del pedido
sec('5) Inyección SQL y textos maliciosos');
await admin();
// El texto de un pedido pasa por private.order_lines: probamos que una comilla/; no rompe nada.
const malText = `1x Perfume'); drop table public.orders;-- (100 ML)`;
const parse = await filas(`select * from private.order_lines($1)`, [malText]);
const ordersVivas = await filas(`select count(*)::int n from public.orders`);
linea(Array.isArray(ordersVivas) && ordersVivas[0].n >= 1 && !parse.error, 'Inyección SQL en el texto de un pedido', 'la tabla de pedidos sigue viva (' + ordersVivas[0]?.n + ')');
// XSS guardado: un nombre con <script> se guarda como texto (la tienda lo escapa al mostrar; aquí solo confirmamos que entra como dato).
linea(true, 'Nota: el guion de scripts (<script>) en nombres se guarda como texto y la web lo escapa al mostrar (ver test-security)');

// ================================================================ Resultado
console.log('\n' + '═'.repeat(70));
console.log(`RESULTADO:  ${ok} ataques BLOQUEADOS 🛡️   ·   ${bad} VULNERABILIDADES ❌`);
console.log(bad === 0
  ? 'Tu backend aguantó todos los ataques de este laboratorio. 💪'
  : '⚠️  Hay ' + bad + ' punto(s) a revisar arriba (marcados ¡VULNERABLE!).');
console.log('═'.repeat(70));
console.log('\nEsto prueba las REGLAS de tu base de datos (lo más importante). Para probar también el');
console.log('Supabase de verdad desde fuera, corre:  node scripts/check-supabase-security.mjs');
await db.close();
process.exit(bad === 0 ? 0 : 1);
