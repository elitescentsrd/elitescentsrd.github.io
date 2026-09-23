// Pruebas de seguridad del sitio publicado (se ejecutan con `npm test`, sin red ni claves):
//  - Política de seguridad de contenido (CSP) en todas las páginas: solo scripts propios, sin eval ni código en línea.
//  - Protección contra clickjacking (frame-guard.js), formularios que nunca ponen datos en la dirección, enlaces seguros.
//  - Ningún patrón peligroso en el JavaScript (eval, innerHTML con datos, document.write) ni claves secretas publicadas.
//  - Migración de protección de pedidos y permisos mínimos del proceso de publicación en GitHub.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderProductPage } from './lib/seo.mjs';

const read = path => readFile(path, 'utf8');
const buildSite = await read('scripts/build-site-artifact.mjs');
const published = [...buildSite.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
assert(published.length > 20, 'Se leyó la lista de archivos publicados');
const indexHtml = await read('index.html');
const products = JSON.parse(indexHtml.match(/<script type="application\/json" id="preRenderedProducts">([\s\S]*?)<\/script>/)[1]);
const pages = [['portada (index.html)', indexHtml], ['página de perfume', renderProductPage(products[0], products.slice(1, 3))]];
for (const file of published.filter(f => f.endsWith('.html') && f !== 'index.html')) pages.push([file, await read(file)]);

// ---------------------------------------------------------------- CSP y HTML de todas las páginas
const cspOf = html => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
for (const [name, html] of pages) {
  const csp = cspOf(html);
  assert(csp, name + ': debe tener política de seguridad de contenido (CSP)');
  const directives = Object.fromEntries(csp.split(';').map(d => d.trim()).filter(Boolean).map(d => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
  assert.deepEqual(directives['script-src'], ["'self'"], name + ': solo se permiten scripts propios (script-src \'self\')');
  assert.deepEqual(directives['default-src'], ["'self'"], name + ': default-src \'self\'');
  assert.deepEqual(directives['object-src'], ["'none'"], name + ': object-src \'none\'');
  assert.deepEqual(directives['base-uri'], ["'self'"], name + ': base-uri \'self\'');
  assert.deepEqual(directives['form-action'], ["'self'"], name + ': form-action \'self\'');
  assert(!/unsafe-eval|\*/.test(csp), name + ': la CSP no permite eval ni comodines');
  for (const origin of (directives['connect-src'] || []).filter(v => v.startsWith('https://'))) assert.equal(origin, 'https://ozowziumksrudrotulll.supabase.co', name + ': solo se conecta a Supabase');
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, tag => tag.replace(/>[\s\S]*<\/script>$/, '></script>'));
  for (const [tag, type] of [...html.matchAll(/<script\b([^>]*)>(?!<\/script>)/g)].map(m => [m[0], m[1]])) {
    if (/\bsrc=/.test(type)) continue;
    assert(/type="application\/(ld\+)?json"/.test(type), name + ': no puede haber código JavaScript en línea: ' + tag.slice(0, 60));
  }
  for (const src of withoutScripts.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) assert(src[1].startsWith('/'), name + ': los scripts se cargan del propio sitio: ' + src[1]);
  assert(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(withoutScripts), name + ': sin manejadores de eventos en línea (onclick=...)');
  assert(!/(href|src|action)="\s*javascript:/i.test(html), name + ': sin enlaces javascript:');
  assert(!/(src|href)="http:\/\//i.test(withoutScripts), name + ': sin recursos por http (sin cifrar)');
  for (const a of withoutScripts.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert(/rel="[^"]*noopener/.test(a[0]), name + ': los enlaces que abren otra pestaña llevan rel="noopener": ' + a[0].slice(0, 70));
  assert(withoutScripts.includes('src="/frame-guard.js"'), name + ': carga la protección contra clickjacking (frame-guard.js)');
}

// ---------------------------------------------------------------- Panel y carrito: páginas protegidas
for (const file of ['admin.html', 'checkout.html']) {
  const html = await read(file);
  const head = html.slice(0, html.indexOf('</head>'));
  assert(/<html [^>]*class="guarded"/.test(html), file + ': se oculta hasta confirmar que no está dentro de otra web');
  assert(head.includes('<script src="/frame-guard.js"></script>'), file + ': frame-guard.js en <head>, sin defer (se ejecuta antes de mostrar la página)');
  assert(head.indexOf('/frame-guard.js') > head.indexOf('rel="stylesheet"'), file + ': la hoja de estilos (que oculta la página) carga antes');
  const forms = [...html.matchAll(/<form\b[^>]*>/g)].map(m => m[0]);
  assert(forms.length >= 5, file + ': tiene formularios');
  for (const form of forms) assert(form.includes('method="post"'), file + ': los formularios nunca envían los datos en la dirección (method="post"): ' + form);
  assert(/<meta name="referrer" content="(no-referrer|strict-origin-when-cross-origin)">/.test(head), file + ': política de referrer');
  assert(/<meta name="robots" content="noindex/.test(head), file + ': no se indexa en Google');
}
const css = await read('tienda.css');
assert(css.includes('html.guarded:not(.guard-ok) body,html.framed body{display:none!important}'), 'La regla que oculta las páginas protegidas está en tienda.css');
assert(published.includes('frame-guard.js'), 'frame-guard.js se publica');

// frame-guard.js: comportamiento con y sin marco (simulado).
{
  const source = await read('frame-guard.js');
  const run = ({ framed, topThrows }) => {
    const classes = new Set(), listeners = [];
    let navigatedTo = null;
    const self = {};
    const top = framed ? { location: { replace: url => { if (topThrows) throw new Error('bloqueado'); navigatedTo = url; } } } : self;
    const window = Object.assign(self, { self, top, location: { href: 'https://tienda.test/admin.html' } });
    const document = { documentElement: { classList: { add: c => classes.add(c) } }, addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
    vm.runInNewContext(source, { window, document });
    return { classes, listeners, navigatedTo };
  };
  const normal = run({ framed: false });
  assert(normal.classes.has('guard-ok') && !normal.classes.has('framed'), 'Sin marco: la página se muestra');
  const submit = normal.listeners.find(l => l.type === 'submit');
  assert(submit && submit.capture === true, 'Se intercepta el envío de formularios en la fase de captura');
  let prevented = false; submit.fn({ preventDefault: () => { prevented = true; } });
  assert(prevented, 'Ningún formulario se envía a la antigua (los datos no van en la dirección)');
  const framed = run({ framed: true });
  assert(framed.classes.has('framed') && !framed.classes.has('guard-ok'), 'Dentro de otra web: la página queda oculta');
  assert.equal(framed.navigatedTo, 'https://tienda.test/admin.html', 'Dentro de otra web: intenta abrirse a pantalla completa');
  const blocked = run({ framed: true, topThrows: true });
  assert(blocked.classes.has('framed') && !blocked.classes.has('guard-ok'), 'Marco restringido: la página sigue oculta y no falla');
}

// ---------------------------------------------------------------- JavaScript del sitio
for (const file of published.filter(f => f.endsWith('.js'))) {
  const js = await read(file);
  assert(!/\beval\s*\(|new Function\s*\(|document\.write\s*\(|insertAdjacentHTML\s*\(|\.outerHTML\s*=|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/.test(js), file + ': sin eval, document.write ni HTML armado con texto');
  for (const m of js.matchAll(/\.innerHTML\s*=\s*([^;]+)/g)) assert(/^'[^'\\+]*'$/.test(m[1].trim()), file + ': innerHTML solo con texto fijo (nunca con datos): ' + m[0].slice(0, 80));
}

// ---------------------------------------------------------------- Claves secretas: nunca en archivos publicados
{
  const config = await read('supabase-config.js');
  const key = config.match(/publishableKey:\s*'([^']+)'/)[1];
  assert(key.startsWith('sb_publishable_'), 'La clave de Supabase en la web es la pública (sb_publishable_)');
  for (const file of published.filter(f => /\.(js|html|css|json|webmanifest|txt|xml)$/.test(f))) {
    const text = await read(file);
    assert(!/sb_secret_[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(text), file + ': contiene algo que parece una clave secreta');
    for (const jwt of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      const payload = JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8'));
      assert.notEqual(payload.role, 'service_role', file + ': contiene una clave service_role');
    }
  }
}

// ---------------------------------------------------------------- Migración de protección de pedidos
{
  const sql = (await read('supabase/migrations/20260922120000_proteccion_pedidos.sql')).replace(/^--.*$/gm, '');
  assert(!/create or replace function public\.place_customer_order\s*\(/i.test(sql), 'No reemplaza la función original de pedidos');
  assert(/alter table public\.store_settings enable row level security/i.test(sql) && /revoke all on public\.store_settings from anon, authenticated/i.test(sql), 'store_settings con RLS y sin permisos por defecto');
  assert(/grant select, update \(orders_paused, updated_at\) on public\.store_settings to authenticated/i.test(sql), 'Solo se pueden cambiar las columnas del interruptor');
  assert((sql.match(/private\.is_store_admin\(\)/g) || []).length >= 4, 'Solo administradores leen y cambian los ajustes, y no tienen límite');
  assert(/security definer\s+set search_path = ''/i.test(sql) && /revoke all on function private\.protect_web_orders\(\) from public, anon, authenticated/i.test(sql), 'La función del trigger es privada y con search_path vacío');
  assert(/before insert on public\.orders/i.test(sql) && /interval '10 minutes'/.test(sql) && /v_recent >= 3/.test(sql) && /v_day >= 10/.test(sql), 'Límite de 3 pedidos cada 10 minutos y 10 por día');
  assert(/pg_advisory_xact_lock/.test(sql), 'Los pedidos simultáneos de una cuenta no se saltan el límite');
  const adminJs = await read('admin.js'), adminHtml = await read('admin.html');
  for (const id of ['security-card', 'orders-state', 'orders-pause', 'security-notice', 'backup-download', 'backup-status']) assert(adminHtml.includes('id="' + id + '"'), 'El panel tiene #' + id);
  assert(adminJs.includes("'/rest/v1/store_settings?id=eq.true'") && adminJs.includes('orders_paused: next'), 'El panel cambia el interruptor');
  assert(adminJs.includes('async function fetchAll(') && /limit=' \+ size \+ '&offset=/.test(adminJs), 'El respaldo lee las tablas completas por páginas');
  for (const table of ['products', 'orders', 'admin_list_customers', 'coupons', 'coupon_redemptions', 'store_settings']) assert(adminJs.includes(table), 'El respaldo incluye ' + table);
}

// ---------------------------------------------------------------- Proceso de publicación en GitHub (permisos mínimos)
{
  const wf = (await read('.github/workflows/pages.yml')).replace(/\r\n/g, '\n'); // igual en Windows (CRLF) que en GitHub (LF)
  const top = wf.slice(wf.indexOf('\npermissions:'), wf.indexOf('\nconcurrency:'));
  assert(/contents: read/.test(top) && !/write/.test(top), 'Por defecto el proceso solo puede leer el código');
  const job = name => { const start = wf.indexOf('\n  ' + name + ':'); const next = wf.slice(start + 3).search(/\n  [a-z]+:\n/); return wf.slice(start, next < 0 ? undefined : start + 3 + next); };
  assert(!/write/.test(job('build')) && /permissions:\s+contents: read/.test(job('build')), 'El trabajo que construye la web no puede escribir nada');
  assert(/pages: write/.test(job('deploy')) && /id-token: write/.test(job('deploy')), 'Solo el trabajo de publicar puede escribir en Pages');
  assert.equal((wf.match(/actions\/checkout@/g) || []).length, (wf.match(/persist-credentials: false/g) || []).length, 'El token de GitHub no se guarda en el disco');
  assert(!/pull_request_target/.test(wf), 'No se usa pull_request_target (daría permisos a código ajeno)');
  assert(/@electric-sql\/pglite@\d+\.\d+\.\d+/.test(wf), 'El paquete de pruebas de base de datos tiene versión exacta');
  assert(!/upload-pages-artifact/.test(job('sql')), 'Las pruebas con paquetes externos no tocan el sitio que se publica');
}
console.log('Pruebas de seguridad superadas: CSP en ' + pages.length + ' páginas, clickjacking, formularios, JavaScript, claves y permisos.');
