// Comprobación de seguridad SOLO con la clave pública (publishable) y sin sesión: lo que puede hacer un visitante.
// No escribe datos: las operaciones de escritura usan un filtro que no coincide con ninguna fila (id=eq.-1)
// y los pedidos/perfiles solo se leen. No usa ni necesita ninguna clave secreta.
//
//   node scripts/check-supabase-security.mjs            informa; los pendientes de migración salen como AVISO
//   node scripts/check-supabase-security.mjs --strict   cualquier AVISO cuenta como fallo (usar tras aplicar las migraciones)
import { readFile } from 'node:fs/promises';

const strict = process.argv.includes('--strict');
const config = await readFile('supabase-config.js', 'utf8');
const base = config.match(/url:\s*['"]([^'"]+)['"]/)?.[1]?.replace(/\/$/, '');
const key = config.match(/publishableKey:\s*['"]([^'"]+)['"]/)?.[1];
if (!base || !key) throw new Error('No se encontró la configuración pública de Supabase.');

const results = [];
const record = (level, name, detail) => { results.push({ level, name, detail }); console.log((level === 'OK' ? '  ok    ' : level === 'AVISO' ? '  AVISO ' : level === 'INFO' ? '  info  ' : '  FALLO ') + name + (detail ? ' — ' + detail : '')); };

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'count=exact' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  return { status: res.status, json, text, range: res.headers.get('content-range') };
}
const denied = r => r.status === 401 || r.status === 403 || r.json?.code === '42501';

// 1. Productos: el visitante solo lee productos activos.
{
  const hidden = await call('GET', '/rest/v1/products?select=id&active=eq.false&limit=5');
  (hidden.status === 200 || hidden.status === 206) && Array.isArray(hidden.json) && hidden.json.length === 0
    ? record('OK', 'Visitantes no ven productos inactivos') : record('FALLO', 'Visitantes no deberían ver productos inactivos', 'HTTP ' + hidden.status + ' ' + hidden.text.slice(0, 80));
  const active = await call('GET', '/rest/v1/products?select=id&active=eq.true&limit=1');
  (active.status === 200 || active.status === 206) && Number(active.range?.split('/')[1]) > 0
    ? record('OK', 'Visitantes leen el catálogo activo', active.range.split('/')[1] + ' productos') : record('FALLO', 'El catálogo activo no se puede leer', 'HTTP ' + active.status);
}
// 2. Productos: un visitante no puede modificar ni borrar (filtro sin coincidencias: no cambia nada aunque fuera permitido).
for (const [method, body] of [['PATCH', { name: 'x' }], ['DELETE', undefined]]) {
  const r = await call(method, '/rest/v1/products?id=eq.-1', body);
  denied(r) ? record('OK', method + ' /products denegado a visitantes', 'HTTP ' + r.status) : record('FALLO', method + ' /products NO está denegado a visitantes', 'HTTP ' + r.status);
}
// 3. Pedidos, administradores y perfiles: un visitante no lee nada.
for (const table of ['orders', 'admin_users', 'customer_profiles']) {
  const r = await call('GET', '/rest/v1/' + table + '?select=*&limit=1');
  const ok = denied(r) || ((r.status === 200 || r.status === 206) && Array.isArray(r.json) && r.json.length === 0);
  ok ? record('OK', 'Visitantes no leen ' + table, 'HTTP ' + r.status + (r.status === 200 ? ' (RLS devuelve vacío)' : '')) : record('FALLO', 'Un visitante puede leer ' + table, 'HTTP ' + r.status);
}
// 4. RPC de pedidos: debe rechazarse por PERMISO (401/403), no solo por la validación interna.
{
  const r = await call('POST', '/rest/v1/rpc/place_customer_order', { p_items: [] });
  if (denied(r)) record('OK', 'place_customer_order: EXECUTE revocado para anon', 'HTTP ' + r.status);
  else if (r.json?.code === 'P0001') record('AVISO', 'place_customer_order sigue ejecutable por anon (solo la rechaza la validación interna)', 'aplicar supabase/migrations/20260920120000_lock_down_place_customer_order.sql');
  else record('FALLO', 'Respuesta inesperada de place_customer_order sin sesión', 'HTTP ' + r.status + ' ' + r.text.slice(0, 100));
}
// 4b. Cupones (migración 20260921130000_cupones.sql): un visitante no puede usar las funciones ni leer las tablas.
//     Si la migración todavía no se aplicó, es un AVISO (no un fallo): las funciones simplemente no existen.
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST202' || r.json?.code === 'PGRST205';
  for (const [name, body] of [['preview_coupon', { p_code: 'X', p_product_ids: [], p_subtotal: 0 }], ['place_customer_order_con_cupon', { p_items: [], p_coupon: 'X' }]]) {
    const r = await call('POST', '/rest/v1/rpc/' + name, body);
    if (denied(r)) record('OK', name + ': EXECUTE revocado para anon', 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', name + ' todavía no existe en Supabase', 'aplicar supabase/migrations/20260921130000_cupones.sql');
    else record('FALLO', 'Respuesta inesperada de ' + name + ' sin sesión', 'HTTP ' + r.status + ' ' + r.text.slice(0, 100));
  }
  for (const table of ['coupons', 'coupon_redemptions', 'coupon_attempts']) {
    const r = await call('GET', '/rest/v1/' + table + '?select=*&limit=1');
    if (denied(r) || ((r.status === 200 || r.status === 206) && Array.isArray(r.json) && r.json.length === 0)) record('OK', 'Visitantes no leen ' + table, 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', 'La tabla ' + table + ' todavía no existe en Supabase', 'aplicar supabase/migrations/20260921130000_cupones.sql');
    else record('FALLO', 'Un visitante puede leer ' + table, 'HTTP ' + r.status);
  }
}
// 4c. Funciones solo para administradores o clientes con sesión: un visitante no debe poder ejecutarlas.
//     (Si la ejecución estuviera permitida, admin_list_customers igual devolvería vacío a un visitante, pero el permiso debe estar cerrado.)
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST202';
  for (const [name, body] of [['admin_list_customers', {}], ['verify_recovery_identity', { p_last4: '' }], ['expire_offers', {}]]) {
    const r = await call('POST', '/rest/v1/rpc/' + name, body);
    if (denied(r)) record('OK', name + ': EXECUTE revocado para anon', 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', name + ' no existe en Supabase', 'revisar las migraciones aplicadas');
    else if (name === 'admin_list_customers' && Array.isArray(r.json) && r.json.length > 0) record('FALLO', 'Un visitante puede listar cuentas de clientes', 'HTTP ' + r.status);
    else record('AVISO', name + ' se puede ejecutar sin sesión (no expone datos, pero el permiso debería estar cerrado)', 'HTTP ' + r.status);
  }
}
// 4d. Ajustes de la tienda (migración 20260922120000_proteccion_pedidos.sql): solo administradores.
{
  const r = await call('GET', '/rest/v1/store_settings?select=*&limit=1');
  if (denied(r) || ((r.status === 200 || r.status === 206) && Array.isArray(r.json) && r.json.length === 0)) record('OK', 'Visitantes no leen store_settings', 'HTTP ' + r.status);
  else if (r.status === 404 || r.json?.code === 'PGRST205') record('AVISO', 'La tabla store_settings todavía no existe en Supabase', 'aplicar supabase/migrations/20260922120000_proteccion_pedidos.sql');
  else record('FALLO', 'Un visitante puede leer store_settings', 'HTTP ' + r.status);
  const w = await call('PATCH', '/rest/v1/store_settings?id=eq.false', { orders_paused: false });
  denied(w) || w.status === 404 || w.json?.code === 'PGRST205' ? record('OK', 'PATCH /store_settings denegado a visitantes', 'HTTP ' + w.status) : record('FALLO', 'PATCH /store_settings NO está denegado a visitantes', 'HTTP ' + w.status);
}
// 4e. Encuesta (migración 20260923120000_encuesta.sql): survey_info es pública (solo si está activa y el monto del cupón);
//     enviar la encuesta, ver cupones personales y leer respuestas exige sesión o ser administrador.
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST202' || r.json?.code === 'PGRST205';
  const info = await call('POST', '/rest/v1/rpc/survey_info', {});
  if (info.status === 200 && info.json && typeof info.json.enabled === 'boolean') {
    const extra = Object.keys(info.json).filter(k => !['enabled', 'amount', 'valid_days', 'min_subtotal'].includes(k));
    extra.length ? record('FALLO', 'survey_info devuelve datos de más', extra.join(', ')) : record('OK', 'survey_info pública solo con los datos de la promoción', 'activa: ' + info.json.enabled);
  } else if (pending(info)) record('AVISO', 'survey_info todavía no existe en Supabase', 'aplicar supabase/migrations/20260923120000_encuesta.sql');
  else record('FALLO', 'Respuesta inesperada de survey_info', 'HTTP ' + info.status + ' ' + info.text.slice(0, 100));
  for (const [name, body] of [['submit_survey', { p_answers: {} }], ['my_survey_coupon', {}]]) {
    const r = await call('POST', '/rest/v1/rpc/' + name, body);
    if (denied(r)) record('OK', name + ': EXECUTE revocado para anon', 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', name + ' todavía no existe en Supabase', 'aplicar supabase/migrations/20260923120000_encuesta.sql');
    else record('FALLO', 'Un visitante puede ejecutar ' + name, 'HTTP ' + r.status + ' ' + r.text.slice(0, 100));
  }
  for (const table of ['survey_responses', 'survey_blocks']) {
    const s = await call('GET', '/rest/v1/' + table + '?select=*&limit=1');
    if (denied(s) || ((s.status === 200 || s.status === 206) && Array.isArray(s.json) && s.json.length === 0)) record('OK', 'Visitantes no leen ' + table, 'HTTP ' + s.status);
    else if (pending(s)) record('AVISO', 'La tabla ' + table + ' todavía no existe en Supabase', 'aplicar supabase/migrations/20260923120000_encuesta.sql');
    else record('FALLO', 'Un visitante puede leer ' + table, 'HTTP ' + s.status);
  }
}
// 4f. Funciones del 30-sep (migración 20260930120000_funciones_y_perfumes_nuevos.sql): «Avísame» y «Lo más vendido» son públicas
//     pero no exponen datos; abonos, costos y avisos solo los leen administradores.
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST202' || r.json?.code === 'PGRST205';
  const aviso = await call('POST', '/rest/v1/rpc/request_restock_alert', { p_product_id: -1, p_name: '', p_phone: '' });
  if (aviso.status === 200 && aviso.json && aviso.json.ok === false) record('OK', 'request_restock_alert valida los datos (no anota nada inválido)');
  else if (pending(aviso)) record('AVISO', 'request_restock_alert todavía no existe en Supabase', 'aplicar supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql');
  else record('FALLO', 'Respuesta inesperada de request_restock_alert', 'HTTP ' + aviso.status + ' ' + aviso.text.slice(0, 100));
  const top = await call('POST', '/rest/v1/rpc/best_sellers', {});
  if (top.status === 200 && Array.isArray(top.json)) {
    const extra = [...new Set(top.json.flatMap(row => Object.keys(row)))].filter(k => k !== 'product_id');
    extra.length ? record('FALLO', 'best_sellers devuelve datos de más', extra.join(', ')) : record('OK', 'best_sellers pública solo con números de perfume', top.json.length + ' perfumes');
  } else if (pending(top)) record('AVISO', 'best_sellers todavía no existe en Supabase', 'aplicar supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql');
  else record('FALLO', 'Respuesta inesperada de best_sellers', 'HTTP ' + top.status + ' ' + top.text.slice(0, 100));
  for (const table of ['restock_alerts', 'order_payments', 'product_costs']) {
    const r = await call('GET', '/rest/v1/' + table + '?select=*&limit=1');
    if (denied(r) || ((r.status === 200 || r.status === 206) && Array.isArray(r.json) && r.json.length === 0)) record('OK', 'Visitantes no leen ' + table, 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', 'La tabla ' + table + ' todavía no existe en Supabase', 'aplicar supabase/migrations/20260930120000_funciones_y_perfumes_nuevos.sql');
    else record('FALLO', 'Un visitante puede leer ' + table, 'HTTP ' + r.status);
  }
  // Si la tabla de costos es una vieja sin las columnas del panel, la API rechaza la petición antes de tocar la base de
  // datos (PGRST204): un visitante igual no escribe nada, pero el panel tampoco puede guardar costos hasta repararla.
  const w = await call('PATCH', '/rest/v1/product_costs?product_id=eq.-1', { strategy: 'normal' });
  if (denied(w) || pending(w)) record('OK', 'PATCH /product_costs denegado a visitantes', 'HTTP ' + w.status);
  else if (w.json?.code === 'PGRST204') record('AVISO', 'La tabla de costos no tiene las columnas del panel (un visitante igual no puede escribir)', 'aplicar supabase/migrations/20261003200000_reparar_tabla_de_costos.sql');
  else record('FALLO', 'PATCH /product_costs NO está denegado a visitantes', 'HTTP ' + w.status + ' ' + (w.json?.code || '') + ' ' + String(w.json?.message || w.text || '').slice(0, 160));
}
// 4g. Estadísticas y publicación automática (migración 20261003120000_estadisticas_y_publicacion.sql): la tienda anota
//     eventos anónimos, pero un visitante nunca lee la tabla ni el resumen del panel.
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST202' || r.json?.code === 'PGRST205';
  const MIG = 'aplicar supabase/migrations/20261003120000_estadisticas_y_publicacion.sql';
  const t = await call('POST', '/rest/v1/rpc/track_event', { p_kind: 'prueba-invalida' });
  if (t.status === 204 || t.status === 200) record('OK', 'track_event acepta la llamada y descarta un tipo inválido', 'HTTP ' + t.status);
  else if (pending(t)) record('AVISO', 'track_event todavía no existe en Supabase', MIG);
  else record('FALLO', 'Respuesta inesperada de track_event', 'HTTP ' + t.status + ' ' + t.text.slice(0, 100));
  const r = await call('GET', '/rest/v1/site_events?select=*&limit=1');
  if (denied(r) || ((r.status === 200 || r.status === 206) && Array.isArray(r.json) && r.json.length === 0)) record('OK', 'Visitantes no leen site_events', 'HTTP ' + r.status);
  else if (pending(r)) record('AVISO', 'La tabla site_events todavía no existe en Supabase', MIG);
  else record('FALLO', 'Un visitante puede leer site_events', 'HTTP ' + r.status);
  const st = await call('POST', '/rest/v1/rpc/admin_site_stats', { p_days: 30 });
  if (denied(st) || st.json?.code === '42501') record('OK', 'admin_site_stats denegado a visitantes', 'HTTP ' + st.status);
  else if (pending(st)) record('AVISO', 'admin_site_stats todavía no existe en Supabase', MIG);
  else record('FALLO', 'Un visitante puede ver el resumen de estadísticas', 'HTTP ' + st.status);
}
// 4h. Líneas de pedido y cantidad en casa (migración 20261003180000_lineas_de_pedido_y_existencias.sql): un visitante
//     solo ve «¡Quedan…!» (products.stock_left, de 0 a 3); nunca las líneas de los pedidos ni la cantidad exacta.
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST205';
  const MIG = 'aplicar supabase/migrations/20261003180000_lineas_de_pedido_y_existencias.sql';
  for (const table of ['order_items', 'product_stock']) {
    const r = await call('GET', '/rest/v1/' + table + '?select=*&limit=1');
    if (denied(r) || ((r.status === 200 || r.status === 206) && Array.isArray(r.json) && r.json.length === 0)) record('OK', 'Visitantes no leen ' + table, 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', 'La tabla ' + table + ' todavía no existe en Supabase', MIG);
    else record('FALLO', 'Un visitante puede leer ' + table, 'HTTP ' + r.status);
  }
  const s = await call('GET', '/rest/v1/products?select=stock_left&stock_left=gt.3&limit=1');
  if ((s.status === 200 || s.status === 206) && Array.isArray(s.json) && s.json.length === 0) record('OK', '«¡Quedan…!» nunca publica más de 3', 'HTTP ' + s.status);
  else if (s.status === 400) record('AVISO', 'products.stock_left todavía no existe en Supabase', MIG);
  else record('FALLO', 'products.stock_left publica una cantidad mayor que 3', 'HTTP ' + s.status);
}
// 4i. Mensajes y reseñas (migración 20261007120000_mensajes_y_resenas.sql): la tienda manda mensajes y reseñas solo con
//     las funciones (que validan); un visitante nunca lee los mensajes, ni el pedido o la conexión de una reseña, ni la
//     lista del panel; de las reseñas solo ve las publicadas.
{
  const pending = r => r.status === 404 || r.json?.code === 'PGRST202' || r.json?.code === 'PGRST205';
  const MIG = 'aplicar supabase/migrations/20261007120000_mensajes_y_resenas.sql';
  const m = await call('POST', '/rest/v1/rpc/send_contact_message', { p_name: '', p_phone: '', p_topic: '', p_message: '' });
  if (m.status === 200 && m.json && m.json.ok === false) record('OK', 'send_contact_message valida los datos (no guarda nada inválido)');
  else if (pending(m)) record('AVISO', 'send_contact_message todavía no existe en Supabase', MIG);
  else record('FALLO', 'Respuesta inesperada de send_contact_message', 'HTTP ' + m.status + ' ' + m.text.slice(0, 100));
  const inv = await call('POST', '/rest/v1/rpc/review_invite', { p_token: '0'.repeat(32) });
  if (inv.status === 200 && inv.json && inv.json.ok === false && !inv.json.products) record('OK', 'review_invite no muestra nada sin un enlace válido');
  else if (pending(inv)) record('AVISO', 'review_invite todavía no existe en Supabase', MIG);
  else record('FALLO', 'Respuesta inesperada de review_invite', 'HTTP ' + inv.status + ' ' + inv.text.slice(0, 100));
  const sub = await call('POST', '/rest/v1/rpc/submit_review', { p_token: '0'.repeat(32), p_product_id: -1, p_rating: 5, p_comment: '', p_author: 'Prueba' });
  if (sub.status === 200 && sub.json && sub.json.ok === false) record('OK', 'submit_review rechaza reseñas sin un enlace válido');
  else if (pending(sub)) record('AVISO', 'submit_review todavía no existe en Supabase', MIG);
  else record('FALLO', 'Respuesta inesperada de submit_review', 'HTTP ' + sub.status + ' ' + sub.text.slice(0, 100));
  const msgs = await call('GET', '/rest/v1/contact_messages?select=*&limit=1');
  if (denied(msgs) || ((msgs.status === 200 || msgs.status === 206) && Array.isArray(msgs.json) && msgs.json.length === 0)) record('OK', 'Visitantes no leen contact_messages', 'HTTP ' + msgs.status);
  else if (pending(msgs)) record('AVISO', 'La tabla contact_messages todavía no existe en Supabase', MIG);
  else record('FALLO', 'Un visitante puede leer los mensajes de contacto', 'HTTP ' + msgs.status);
  const pub = await call('GET', '/rest/v1/product_reviews?select=id,product_id,author_name,rating,comment,created_at&limit=1');
  if ((pub.status === 200 || pub.status === 206) && Array.isArray(pub.json)) record('OK', 'Las reseñas publicadas se leen con sus columnas públicas', pub.json.length + ' leída(s)');
  else if (pending(pub)) record('AVISO', 'La tabla product_reviews todavía no existe en Supabase', MIG);
  else record('FALLO', 'Respuesta inesperada al leer las reseñas publicadas', 'HTTP ' + pub.status + ' ' + pub.text.slice(0, 100));
  for (const col of ['order_id', 'ip_hash', 'status']) {
    const r = await call('GET', '/rest/v1/product_reviews?select=' + col + '&limit=1');
    if (denied(r) || r.json?.code === '42501') record('OK', 'Visitantes no leen product_reviews.' + col, 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', 'La tabla product_reviews todavía no existe en Supabase', MIG);
    else record('FALLO', 'Un visitante puede leer product_reviews.' + col, 'HTTP ' + r.status);
  }
  for (const [name, body] of [['admin_reviews', {}], ['admin_moderate_review', { p_id: -1, p_action: 'borrar' }], ['admin_review_link', { p_order_id: -1 }], ['my_review_link', { p_order_id: -1 }]]) {
    const r = await call('POST', '/rest/v1/rpc/' + name, body);
    if (denied(r)) record('OK', name + ': EXECUTE revocado para anon', 'HTTP ' + r.status);
    else if (pending(r)) record('AVISO', name + ' todavía no existe en Supabase', MIG);
    else record('FALLO', 'Un visitante puede ejecutar ' + name, 'HTTP ' + r.status + ' ' + r.text.slice(0, 100));
  }
}
// 5. Storage: el listado público funciona, pero no se prueba escritura (crearía archivos si fallara la política).
{
  const r = await call('POST', '/storage/v1/object/list/product-images', { prefix: '', limit: 1 });
  r.status === 200 ? record('OK', 'Bucket product-images legible (público, solo lectura)') : record('AVISO', 'No se pudo listar product-images', 'HTTP ' + r.status);
  record('INFO', 'Storage: la política de escritura solo-administrador NO se puede probar sin sesión', 'verificar con supabase/verification/01_audit_queries.sql');
}

const failures = results.filter(r => r.level === 'FALLO').length;
const warnings = results.filter(r => r.level === 'AVISO').length;
console.log('\nSeguridad (visitante): ' + results.filter(r => r.level === 'OK').length + ' correctas, ' + warnings + ' avisos, ' + failures + ' fallos' + (strict ? ' [modo estricto]' : ''));
process.exit(failures || (strict && warnings) ? 1 : 0);
