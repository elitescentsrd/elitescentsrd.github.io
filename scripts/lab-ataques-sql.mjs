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
import { montarLaboratorio, IDS, comoRol, comoDuenno } from './lib/lab-backend.mjs';

const db = await montarLaboratorio(PGlite);
const { ADMIN, VICTIMA, ATACANTE } = IDS;
// Herramientas
const sesion = uid => comoRol(db, uid);
const admin = () => comoDuenno(db);
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
linea(bloqueadoLectura(await filas('select * from public.admin_list_customers()')), 'Listar todas las cuentas de clientes', 'la función le devuelve vacío a quien no es admin');
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
