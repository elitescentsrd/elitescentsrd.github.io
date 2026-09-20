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
