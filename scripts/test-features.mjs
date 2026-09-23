// Pruebas de las funciones nuevas: app instalable (PWA), "Encuentra tu perfume", archivo de productos para Google/Instagram,
// resumen de ventas del panel y cupones de descuento. Se ejecutan con `npm test`.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import { Script } from 'node:vm';
import { renderProductPage, SITE_URL, WHATSAPP, INSTAGRAM } from './lib/seo.mjs';
import { merchantFeed, feedTitle } from './lib/feeds.mjs';

const read = path => readFile(path, 'utf8');
const [indexHtml, template, tiendaJs, adminHtml, adminJs, checkoutHtml, customerJs, buildSite, swSource] = await Promise.all([
  read('index.html'), read('src/index.template.html'), read('tienda.js'), read('admin.html'), read('admin.js'), read('checkout.html'), read('customer.js'), read('scripts/build-site-artifact.mjs'), read('sw.js'),
]);
const products = JSON.parse(indexHtml.match(/<script type="application\/json" id="preRenderedProducts">([\s\S]*?)<\/script>/)[1]);
assert.equal(products.length, 420);
const runUmd = async file => { const ctx = { module: { exports: {} } }; vm.runInNewContext(await read(file), ctx, { filename: file }); return ctx.module.exports; };
const plain = value => JSON.parse(JSON.stringify(value)); // los objetos creados dentro de vm tienen otro prototipo
const idsUsed = (source, pattern) => [...new Set([...source.matchAll(pattern)].map(m => m[1]))];

// ---------------------------------------------------------------- App instalable (PWA)
{
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Elite Scents RD'); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
  assert(manifest.start_url.startsWith('/'), 'start_url debe ser una ruta del propio sitio');
  const purposes = manifest.icons.map(i => i.purpose);
  assert(purposes.includes('any') && purposes.includes('maskable'), 'Debe haber ícono normal y maskable');
  for (const icon of manifest.icons) {
    const path = icon.src.slice(1); assert(existsSync(path), 'Falta el ícono ' + icon.src);
    const png = await readFile(path); assert.equal(png.toString('latin1', 1, 4), 'PNG');
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)], [mw, mh] = icon.sizes.split('x').map(Number);
    assert.deepEqual([w, h], [mw, mh], 'El tamaño real de ' + icon.src + ' debe coincidir con el manifiesto');
  }
  assert(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'));
  assert.deepEqual([...(await readFile('img/app/apple-touch-icon.png')).subarray(16, 24)], [0, 0, 0, 180, 0, 0, 0, 180], 'apple-touch-icon de 180x180');
  for (const html of [template, indexHtml, renderProductPage(products[0], [])]) {
    assert(html.includes('rel="manifest" href="/manifest.webmanifest"') && html.includes('rel="apple-touch-icon"'), 'Cada página pública enlaza el manifiesto y el ícono de iOS');
    assert(html.includes('src="/pwa.js"'), 'Cada página pública carga pwa.js');
  }
  assert(template.includes('data-install-app'), 'Debe existir el botón de instalar');
  // App del panel: manifiesto propio (otro nombre, otro ícono y solo /admin.html), instalable por separado de la tienda.
  const panel = JSON.parse(await read('admin.webmanifest'));
  assert.equal(panel.id, '/admin.html'); assert.equal(panel.start_url, '/admin.html'); assert.equal(panel.scope, '/admin.html');
  assert.equal(panel.display, 'standalone'); assert.notEqual(panel.name, manifest.name, 'El panel se llama distinto que la tienda');
  assert(panel.short_name.length <= 12, 'El nombre corto cabe debajo del ícono');
  assert.notEqual(panel.id, manifest.id || manifest.start_url, 'Panel y tienda son apps distintas (id diferente)');
  assert(panel.icons.some(i => i.purpose === 'maskable') && panel.icons.some(i => i.sizes === '192x192') && panel.icons.some(i => i.sizes === '512x512'));
  for (const icon of panel.icons) {
    assert(icon.src.startsWith('/img/app/panel-'), 'El panel usa sus propios íconos: ' + icon.src);
    const png = await readFile(icon.src.slice(1)), [mw, mh] = icon.sizes.split('x').map(Number);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [mw, mh], 'Tamaño real de ' + icon.src);
  }
  assert.deepEqual([...(await readFile('img/app/panel-apple-touch-icon.png')).subarray(16, 24)], [0, 0, 0, 180, 0, 0, 0, 180], 'ícono de iPhone del panel de 180x180');
  assert(adminHtml.includes('<link rel="manifest" href="/admin.webmanifest">') && adminHtml.includes('rel="apple-touch-icon" href="/img/app/panel-apple-touch-icon.png"'), 'admin.html enlaza el manifiesto y el ícono del panel');
  assert(!adminHtml.includes('/manifest.webmanifest'), 'El panel no usa el manifiesto de la tienda');
  assert(/<button [^>]*data-install-app="el panel"[^>]*hidden/.test(adminHtml) && adminHtml.includes('<script src="/pwa.js"></script>'), 'El panel tiene su botón de instalar y carga pwa.js');
  assert((await read('admin.css')).includes('[data-install-app][hidden]{display:none!important}'), 'El botón de instalar del panel se oculta cuando no se puede instalar');
  assert(buildSite.includes("'admin.webmanifest'"), 'admin.webmanifest se publica');
  for (const file of ['pwa.js', 'sw.js', 'offline.html', 'manifest.webmanifest', 'aroma.js', 'sales.js']) assert(buildSite.includes("'" + file + "'"), file + ' debe publicarse en _site');
  for (const file of ['pwa.js', 'sw.js', 'aroma.js', 'sales.js']) new Script(await read(file), { filename: file });
  assert(swSource.includes("const VERSION = 'elite-v__BUILD_ID__'") && buildSite.includes('replaceAll(') && buildSite.includes('__BUILD_ID__'), 'El build debe versionar el service worker');
  assert.equal(swSource.match(/__BUILD_ID__/g).length, 1, 'El marcador de versión aparece una sola vez en sw.js');
  assert(await read('offline.html').then(t => t.includes('noindex')), 'offline.html no debe indexarse');
  assert(!/checkout|admin/.test(await read('sitemap.xml').then(t => t)), 'El sitemap no incluye páginas privadas');

  // Simulación del service worker con caches y red falsos.
  const build = () => {
    const stores = new Map(), listeners = {};
    const keyOf = request => typeof request === 'string' ? new URL(request, 'https://tienda.test').href : request.url;
    const caches = {
      async open(name) { if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name); return {
        async addAll(urls) { for (const u of urls) store.set(keyOf(u), new Response('precargado ' + u)); },
        async put(request, response) { store.set(keyOf(request), response); },
        async keys() { return [...store.keys()].map(url => ({ url })); },
        async delete(request) { return store.delete(keyOf(request)); } }; },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
      async match(request) { for (const store of stores.values()) if (store.has(keyOf(request))) return store.get(keyOf(request)).clone(); return undefined; },
    };
    const state = { online: true, fetched: [] };
    const sandbox = {
      caches, URL, Response, Promise,
      // Una respuesta del propio sitio (type "basic"): solo esas se guardan en la caché.
      fetch: async request => { state.fetched.push(keyOf(request)); if (!state.online) throw new TypeError('sin red'); const r = new Response('de la red ' + keyOf(request)); Object.defineProperty(r, 'type', { value: 'basic' }); return r; },
      self: { addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting: () => Promise.resolve(), location: { origin: 'https://tienda.test' }, clients: { claim: () => Promise.resolve() } },
    };
    vm.runInNewContext(swSource.replaceAll('__BUILD_ID__', 'prueba'), sandbox, { filename: 'sw.js' });
    const dispatch = request => { let handled = null; listeners.fetch({ request, respondWith: promise => { handled = promise; } }); return handled; };
    const lifecycle = async type => { let work = Promise.resolve(); await listeners[type]({ waitUntil: promise => { work = promise; } }); await work; };
    return { stores, state, dispatch, lifecycle, caches };
  };
  const req = (path, extra = {}) => ({ method: 'GET', url: 'https://tienda.test' + path, mode: 'no-cors', ...extra });
  const sw = build();
  await sw.lifecycle('install');
  assert((await sw.caches.keys()).includes('elite-vprueba-static'), 'install precarga la versión actual');
  assert((await sw.caches.match('/offline.html')), 'la página sin conexión queda precargada');
  await sw.caches.open('elite-vantigua-pages'); await sw.caches.open('otra-app-cache');
  await sw.lifecycle('activate');
  assert(!(await sw.caches.keys()).includes('elite-vantigua-pages'), 'activate borra las copias de versiones anteriores');
  assert((await sw.caches.keys()).includes('otra-app-cache'), 'activate no toca cachés ajenas');
  for (const path of ['/admin.js', '/admin.css', '/admin.webmanifest', '/checkout.css', '/customer.js']) assert.equal(sw.dispatch(req(path)), null, path + ' nunca pasa por el service worker');
  // Panel y carrito: siempre desde la red y nunca guardados; sin internet se muestra la página "Sin conexión".
  for (const path of ['/admin.html', '/checkout.html', '/admin.html?source=app']) {
    let page = await sw.dispatch(req(path, { mode: 'navigate' }));
    assert.match(await page.text(), /de la red/, path + ' con internet llega de la red');
    await new Promise(r => setTimeout(r, 10));
    for (const name of await sw.caches.keys()) for (const key of await (await sw.caches.open(name)).keys()) assert(!/\/(admin|checkout)/.test(key.url), path + ' nunca se guarda en el celular (' + key.url + ')');
    sw.state.online = false;
    page = await sw.dispatch(req(path, { mode: 'navigate' }));
    assert.match(await page.text(), /precargado \/offline\.html/, path + ' sin internet muestra "Sin conexión"');
    sw.state.online = true;
  }
  assert.equal(sw.dispatch({ method: 'POST', url: 'https://tienda.test/', mode: 'no-cors' }), null, 'solo se atienden GET');
  assert.equal(sw.dispatch({ method: 'GET', url: 'https://ozowziumksrudrotulll.supabase.co/rest/v1/products', mode: 'cors' }), null, 'Supabase y otras direcciones externas no se tocan');
  // Página: red primero, copia si no hay red, aviso "sin conexión" si nunca se visitó.
  let response = await sw.dispatch(req('/perfumes/x-1.html', { mode: 'navigate' })); assert.match(await response.text(), /de la red/);
  await new Promise(r => setTimeout(r, 10)); sw.state.online = false;
  response = await sw.dispatch(req('/perfumes/x-1.html', { mode: 'navigate' })); assert.match(await response.text(), /de la red/, 'sin red se muestra la copia guardada');
  response = await sw.dispatch(req('/perfumes/nunca-visitada.html', { mode: 'navigate' })); assert.match(await response.text(), /precargado \/offline\.html/, 'sin red y sin copia: página sin conexión');
  // CSS/JS: red primero (evita mezclar HTML nuevo con JavaScript viejo).
  sw.state.online = true; response = await sw.dispatch(req('/tienda.js')); assert.match(await response.text(), /de la red/);
  await new Promise(r => setTimeout(r, 10)); sw.state.online = false;
  response = await sw.dispatch(req('/tienda.js')); assert.match(await response.text(), /de la red/, 'sin red se usa la copia del JavaScript');
  // Imágenes: copia primero.
  sw.state.online = true; await (await sw.dispatch(req('/img/productos/thumbs/0001.webp'))).text(); await new Promise(r => setTimeout(r, 10));
  sw.state.fetched.length = 0; response = await sw.dispatch(req('/img/productos/thumbs/0001.webp')); assert.match(await response.text(), /de la red/); assert(sw.state.fetched.length === 1, 'la imagen se renueva en segundo plano');
  console.log('App instalable: manifiesto, íconos, páginas y service worker (simulado) correctos.');
}

// ---------------------------------------------------------------- Encuentra tu perfume
{
  const A = await runUmd('aroma.js');
  const expected = { 'Pimienta rosa': 'especiado', 'Toronja rosada': 'fresco', 'Water Peony': 'floral', 'Manzana verde': 'frutal', 'Flor de azahar': 'floral', 'Ámbar gris': 'amaderado', 'Haba tonka': 'dulce', 'Notas marinas': 'fresco', 'Musgo de roble': 'amaderado', 'Cuero': 'especiado', 'Coconut Water': 'frutal', 'Té verde': 'fresco', 'Vainilla': 'dulce', 'Bergamota': 'fresco', 'Oud': 'amaderado', 'Jazmín': 'floral', 'Canela': 'especiado', 'Piña': 'frutal', 'Almizcle': null };
  for (const [note, family] of Object.entries(expected)) assert.equal(A.familyOf(note), family, 'Familia de "' + note + '"');
  const withFamily = products.filter(p => A.familiesOf(p).length);
  assert.equal(withFamily.length, 420, 'Los 420 perfumes deben tener al menos una familia de aroma');
  const perFamily = {}; for (const p of products) for (const f of A.familiesOf(p)) perFamily[f] = (perFamily[f] || 0) + 1;
  for (const family of Object.keys(A.FAMILIES)) assert((perFamily[family] || 0) >= 100, 'La familia ' + family + ' debe tener perfumes suficientes (' + (perFamily[family] || 0) + ')');
  const scenario = (answers, check) => { const { items, total } = A.recommend(products, answers, 6); assert(items.length > 0 && total >= items.length); check(items); return items; };
  scenario({ who: 'hombre', occasion: 'noche', families: ['amaderado', 'especiado'], budget: '5000' }, items => {
    assert(items.every(i => ['hombre', 'unisex'].includes(i.product.gender)), 'Para él: hombre o unisex');
    assert(items.every(i => A.minPrice(i.product) <= 5000), 'Respeta el presupuesto');
    assert(items.every(i => i.product.availability !== 'agotado'));
    assert(items.every(i => i.reasons.length && i.reasons.every(r => r.notes.length)), 'Cada resultado explica por qué coincide');
    assert(items.every((i, n) => n === 0 || items[n - 1].score >= i.score), 'Ordenado por afinidad');
  });
  scenario({ who: 'mujer', occasion: 'calor', families: ['floral', 'frutal'], budget: '3000' }, items => assert(items.every(i => ['mujer', 'unisex'].includes(i.product.gender) && A.minPrice(i.product) <= 3000)));
  const brandCount = {}; A.recommend(products, { who: 'todos', occasion: 'cita', families: [], budget: 'sin' }, 6).items.forEach(i => { brandCount[i.product.brand] = (brandCount[i.product.brand] || 0) + 1; });
  assert(Object.values(brandCount).every(n => n <= 2), 'Máximo 2 perfumes por marca en la lista');
  assert.equal(A.recommend(products, {}, 6).items.length, 6, 'Sin respuestas también se sugiere una selección');
  assert.equal(A.recommend(products, { who: 'mujer', families: ['frutal'], budget: '1' }, 6).items.length, 0, 'Un presupuesto imposible no devuelve nada');
  const soldOut = [{ id: 1, name: 'A', brand: 'X', gender: 'unisex', price: 'RD$1,000', availability: 'agotado', notes_top: ['Vainilla'], notes_heart: [], notes_base: [] }];
  assert.equal(A.recommend(soldOut, { families: ['dulce'] }).items.length, 0, 'No se recomiendan perfumes agotados');
  assert.match(A.describeAnswers({ who: 'hombre', occasion: 'noche', families: ['amaderado', 'especiado'], budget: '5000' }), /para él.*noche.*amaderado y ámbar.*especiado e intenso.*RD\$5,000/);
  assert.equal(A.STEPS.length, 4);
  // Pantalla: todos los elementos que usa tienda.js existen en la plantilla y aroma.js carga antes.
  const finderIds = idsUsed(tiendaJs, /\$\('#(finder[A-Za-z]*)'\)/g);
  assert(finderIds.length >= 12); for (const id of finderIds) assert(template.includes('id="' + id + '"'), 'Falta #' + id + ' en la plantilla');
  assert(template.indexOf('/aroma.js') > -1 && template.indexOf('/aroma.js') < template.indexOf('/tienda.js'), 'aroma.js debe cargar antes que tienda.js');
  assert((template.match(/data-open-finder/g) || []).length >= 2, 'El buscador debe tener al menos dos accesos');
  assert(tiendaJs.includes("if(finderDialog&&Aroma)"), 'Sin aroma.js la tienda debe seguir funcionando');
  console.log('Encuentra tu perfume: familias de los 420 perfumes, recomendaciones y pantalla correctas.');
}

// ---------------------------------------------------------------- Archivo de productos para Google / Instagram
{
  const { xml, included, skipped } = merchantFeed(products, new Date('2026-09-21T12:00:00Z'));
  assert.equal(included + skipped.length, 420); assert(included >= 410, 'Casi todos los perfumes deben estar en el archivo (' + included + ')');
  assert.equal((xml.match(/<item>/g) || []).length, included); assert.equal((xml.match(/<\/item>/g) || []).length, included);
  assert(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(xml), 'El XML no puede tener & sin escapar');
  assert(!Array.from(xml).some(ch => { const c = ch.codePointAt(0); return c < 9 || c === 11 || c === 12 || (c > 13 && c < 32); }), 'Sin caracteres de control');
  const items = xml.split('<item>').slice(1);
  for (const item of items) {
    for (const tag of ['g:id', 'title', 'description', 'link', 'g:image_link', 'g:availability', 'g:price', 'g:brand', 'g:condition']) assert(item.includes('<' + tag + '>'), 'Falta ' + tag);
    assert.match(item.match(/<g:price>([^<]*)<\/g:price>/)[1], /^\d+\.\d{2} DOP$/);
    assert.match(item.match(/<g:availability>([^<]*)<\/g:availability>/)[1], /^(in_stock|out_of_stock|backorder)$/);
    assert(item.match(/<link>([^<]*)<\/link>/)[1].startsWith('https://elitescentsrd.github.io/perfumes/'));
    assert(item.match(/<g:image_link>([^<]*)<\/g:image_link>/)[1].startsWith('https://'), 'La foto debe ser una URL completa');
    assert(item.match(/<title>([^<]*)<\/title>/)[1].length <= 150);
  }
  assert(skipped.every(s => s.reason === 'varias presentaciones' || s.reason === 'sin foto' || s.reason === 'sin precio'));
  const sample = { id: 9999, name: 'Prueba Uno', brand: 'Marca', size: '100 ML', gender: 'mujer', price: 'RD$2,700', original_price: 'RD$3,000', offer_ends_at: '2026-10-01T04:00:00Z', availability: 'encargo', image_url: '/img/productos/9999-x.jpg', description: 'Fragancia & más <b>', notes_top: ['A'], notes_heart: [], notes_base: [] };
  const offer = merchantFeed([sample, { ...sample, id: 10000, image_url: null }, { ...sample, id: 10001, price: 'RD$3,550 / RD$4,150', original_price: null }], new Date('2026-09-21T12:00:00Z'));
  assert.equal(offer.included, 1); assert.deepEqual(offer.skipped.map(s => s.reason), ['sin foto', 'varias presentaciones']);
  assert(offer.xml.includes('<g:price>3000.00 DOP</g:price>') && offer.xml.includes('<g:sale_price>2700.00 DOP</g:sale_price>'), 'La oferta usa price (normal) y sale_price (oferta)');
  assert(offer.xml.includes('<g:sale_price_effective_date>2026-09-21T12:00:00Z/2026-10-01T04:00:00Z</g:sale_price_effective_date>'));
  assert(offer.xml.includes('<g:availability>backorder</g:availability>') && offer.xml.includes('<g:gender>female</g:gender>'));
  assert(offer.xml.includes('Fragancia &amp; más &lt;b&gt;'), 'El texto se escapa');
  assert.equal(feedTitle({ name: 'Lattafa Asad', brand: 'Lattafa', size: '100 ML' }), 'Lattafa Asad 100 ML', 'No repite la marca');
  assert(buildSite.includes("'/feeds/productos.xml'"), 'El build publica /feeds/productos.xml');
  console.log('Archivo de productos: ' + included + ' perfumes válidos (omitidos ' + skipped.length + ').');
}

// ---------------------------------------------------------------- Resumen de ventas
{
  const S = await runUmd('sales.js');
  assert.equal(S.amountOf({ amount: 'RD$7,500' }), 7500); assert.equal(S.amountOf({ amount: 'RD$3,550 / RD$4,150' }), 3550); assert.equal(S.amountOf({ amount: 'Por confirmar' }), 0); assert.equal(S.amountOf({}), 0);
  assert.deepEqual(plain(S.parseItems('2x Dior Sauvage EDP (100 ML)\n1x Lattafa Asad')), [{ name: 'Dior Sauvage EDP', qty: 2 }, { name: 'Lattafa Asad', qty: 1 }]);
  assert.deepEqual(plain(S.parseItems('3 × Armaf Club · 100 ML; Versace Eros')), [{ name: 'Armaf Club', qty: 3 }, { name: 'Versace Eros', qty: 1 }]);
  assert.deepEqual(plain(S.parseItems('')), []);
  const now = new Date(2026, 8, 21, 15, 0), at = (daysAgo, hour = 12) => new Date(2026, 8, 21 - daysAgo, hour).toISOString();
  const order = (id, daysAgo, status, amount, items) => ({ id, created_at: at(daysAgo), status, amount, items });
  const orders = [order(1, 0, 'nuevo', 'RD$3,500', '1x Lattafa Asad (100 ML)'), order(2, 1, 'confirmado', 'RD$7,500', '2x Dior Sauvage EDP (100 ML)\n1x Lattafa Asad (100 ML)'), order(3, 3, 'entregado', 'RD$4,000', '1x Armaf Club de Nuit'),
    order(4, 5, 'cancelado', 'RD$9,999', '1x Perfume cancelado'), order(5, 12, 'enviado', 'RD$5,000', '1x Dior Sauvage EDP'), order(6, 40, 'entregado', 'RD$6,000', '1x Versace Eros'), order(7, 50, 'confirmado', 'RD$3,000', '1x Lattafa Asad'), { id: 8, created_at: 'no es fecha', status: 'entregado', amount: 'RD$1,000', items: '' }];
  const customers = [{ pedidos: 2, origen: { fuente: 'l.instagram.com' } }, { pedidos: 1, origen: { fuente: 'www.google.com' } }, { pedidos: 0, origen: { fuente: 'directo' } }, { pedidos: 1, origen: { fuente: 'x', utm: { source: 'instagram' } } }, { pedidos: 0, origen: { fuente: 'sin consentimiento' } }, { pedidos: 0 }];
  const s30 = S.summarize(orders, customers, { period: '30', now });
  assert.deepEqual([s30.totals.received, s30.totals.soldCount, s30.totals.sales, s30.totals.average, s30.totals.pendingCount, s30.totals.pendingAmount, s30.totals.cancelled], [5, 3, 16500, 5500, 1, 3500, 1]);
  assert.deepEqual([s30.previous.received, s30.previous.sales], [2, 9000]);
  assert.equal(S.change(s30.totals.received, s30.previous.received), 150); assert.equal(S.change(s30.totals.sales, s30.previous.sales), 83); assert.equal(S.change(5, 0), null);
  assert.equal(s30.days.length, 30); assert.equal(s30.days.at(-1).orders, 1, 'hoy: 1 pedido'); assert.equal(s30.days.reduce((n, d) => n + d.orders, 0), 4, 'los cancelados no cuentan en el gráfico');
  assert.equal(s30.days.reduce((n, d) => n + d.sales, 0), 16500);
  assert.deepEqual(plain(s30.top.map(t => [t.name, t.units, t.orders])), [['Dior Sauvage EDP', 3, 2], ['Lattafa Asad', 2, 2], ['Armaf Club de Nuit', 1, 1]], 'Los más pedidos suman unidades y omiten cancelados');
  assert.equal(S.summarize(orders, customers, { period: 'today', now }).totals.received, 1);
  assert.equal(S.summarize(orders, customers, { period: 'today', now }).days.length, 1);
  assert.equal(S.summarize(orders, customers, { period: '7', now }).days.length, 7);
  const all = S.summarize(orders, customers, { period: 'all', now }); assert.equal(all.previous, null); assert.equal(all.totals.received, 7, 'la fecha inválida no se cuenta'); assert.equal(all.days.length, 51);
  assert.equal(S.summarize([], [], { period: 'all', now }).days.length, 1);
  assert.deepEqual(plain(s30.origins.map(o => [o.name, o.accounts, o.buyers, o.orders])), [['Instagram', 2, 2, 3], ['Directo (escribió la dirección o la guardó)', 1, 0, 0], ['Google', 1, 1, 1], ['Sin datos', 1, 0, 0], ['Sin permiso de cookies', 1, 0, 0]].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es')));
  for (const [source, name] of [['l.facebook.com', 'Facebook'], ['wa.me', 'WhatsApp'], ['www.tiktok.com', 'TikTok'], ['t.co', 'X / Twitter'], ['www.ejemplo.do', 'ejemplo.do']]) assert.equal(S.originName({ fuente: source }), name, source);
  const ids = idsUsed(adminJs, /\$\('#((?:sales|coupon|coupons)-[a-z-]+)'\)/g);
  assert(ids.length >= 10); for (const id of ids) assert(adminHtml.includes('id="' + id + '"'), 'Falta #' + id + ' en admin.html');
  assert(adminHtml.indexOf('/sales.js') > -1 && adminHtml.indexOf('/sales.js') < adminHtml.indexOf('/admin.js'), 'sales.js carga antes que admin.js');
  assert(adminHtml.includes('data-sales-metric="orders"') && adminHtml.includes('data-sales-metric="sales"'));
  assert(!/style="/.test(adminHtml), 'El panel no usa estilos en línea (su política de seguridad los bloquea)');
  console.log('Resumen de ventas: totales, comparación, gráfico, más pedidos y orígenes correctos.');
}

// ---------------------------------------------------------------- Cupones de descuento
{
  const sql = await read('supabase/migrations/20260921130000_cupones.sql');
  const code = sql.replace(/^--.*$/gm, '');
  assert(!/create or replace function public\.place_customer_order\s*\(/i.test(code), 'La migración NO debe reemplazar la función original place_customer_order');
  assert(/do \$\$[\s\S]*to_regprocedure\('public\.place_customer_order\(jsonb\)'\) is null[\s\S]*raise exception/i.test(code), 'Debe comprobar que existe la función original antes de cambiar nada');
  for (const table of ['coupons', 'coupon_redemptions', 'coupon_attempts']) assert(new RegExp('alter table public\\.' + table + ' enable row level security', 'i').test(code), 'RLS en ' + table);
  assert(/revoke all on public\.coupons, public\.coupon_redemptions, public\.coupon_attempts from anon, authenticated/i.test(code));
  assert(!/grant[^;]*coupon_attempts/i.test(code), 'Nadie lee coupon_attempts');
  assert((code.match(/security definer/gi) || []).length === 3 && (code.match(/set search_path = ''/g) || []).length === 3, 'Las 3 funciones son SECURITY DEFINER con search_path vacío');
  assert(/revoke all on function public\.preview_coupon\(text, bigint\[\], numeric\) from public, anon/i.test(code) && /grant execute on function public\.preview_coupon\(text, bigint\[\], numeric\) to authenticated/i.test(code));
  assert(/revoke all on function public\.place_customer_order_con_cupon\(jsonb, text\) from public, anon/i.test(code) && /grant execute on function public\.place_customer_order_con_cupon\(jsonb, text\) to authenticated/i.test(code));
  assert(/revoke all on function private\.coupon_evaluate\([^)]*\) from public, anon, authenticated/i.test(code), 'coupon_evaluate no es pública');
  assert(/for update/i.test(code), 'El cupón se bloquea para no pasarse del máximo de usos');
  assert(/private\.is_store_admin\(\)/.test(code) && /create policy "Admins gestionan cupones"/i.test(code));
  assert(code.includes("select to_jsonb(public.place_customer_order($1))"), 'El pedido se crea con la función original');
  // Navegador: el descuento nunca viaja desde el cliente y sin código se usa la función de siempre.
  assert(customerJs.includes("code?await authFetch('/rest/v1/rpc/place_customer_order_con_cupon'") && customerJs.includes("await authFetch('/rest/v1/rpc/place_customer_order',{method:'POST',body:JSON.stringify({p_items:payload})})"));
  assert(!/p_discount|p_total|discount_amount\s*:/.test(customerJs), 'El navegador no envía descuentos ni totales');
  assert(customerJs.includes("rpc/preview_coupon") && customerJs.includes('p_coupon:code'));
  for (const id of idsUsed(customerJs, /\$\('#((?:coupon|applyCoupon|removeCoupon|finalRow|finalTotal)[A-Za-z]*)'\)/g)) assert(checkoutHtml.includes('id="' + id + '"'), 'Falta #' + id + ' en checkout.html');
  assert(checkoutHtml.includes('id="couponBox" class="coupon-box hidden"'), 'La caja del cupón empieza oculta hasta comprobar que existe en Supabase');
  for (const id of ['coupon-form', 'coupons-body', 'coupons-notice', 'coupons-clean', 'coupons-refresh']) assert(adminHtml.includes('id="' + id + '"'));
  // Eliminar cupones ya usados: segunda migración (el historial de usos se borra con el cupón; los pedidos no se tocan).
  const removeSql = (await read('supabase/migrations/20260921140000_cupones_eliminar.sql')).replace(/^--.*$/gm, '');
  assert(/on delete cascade/i.test(removeSql) && /foreign key \(coupon_code\) references public\.coupons \(code\)/i.test(removeSql), 'El historial de usos se borra junto con el cupón');
  assert(/raise exception[\s\S]*20260921130000_cupones\.sql/i.test(removeSql), 'Comprueba que la migración de cupones ya esté aplicada');
  assert(!/\b(drop table|truncate|delete from|update public\.orders|alter table public\.orders)\b/i.test(removeSql), 'No toca pedidos ni borra datos');
  assert(adminJs.includes('async function deleteCoupons(') && adminJs.includes('cupones_eliminar') && adminJs.includes("code=in.("), 'El panel elimina uno o varios cupones');
  assert(adminJs.includes('también se borra su historial de usos') && adminJs.includes('los pedidos conservan el cupón'), 'El panel avisa qué se borra antes de eliminar un cupón usado');
  assert(!adminJs.includes('no se puede eliminar. Desactívalo'), 'Ya no se rechaza eliminar un cupón usado');
  assert(adminJs.includes("['Vencido', 'Agotado', 'Inactivo'].includes(couponState(c))"), 'Limpiar solo quita cupones vencidos, agotados o desactivados (nunca activos ni programados)');
  assert(/Prefer:\s*'return=minimal'/.test(adminJs.slice(adminJs.indexOf('// --- Cupones de descuento'))));
  assert(!/e\.currentTarget\.reset\(\)/.test(adminJs), 'currentTarget es null después de un await: el formulario se guarda antes');
  const security = await read('scripts/check-supabase-security.mjs');
  assert(security.includes('preview_coupon'), 'La revisión de seguridad también prueba las funciones de cupones');
  console.log('Cupones: migración segura (RLS, permisos, función original intacta) y pantallas conectadas.');
}

// ---------------------------------------------------------------- Google Search Console
{
  const files = (await readdir('.')).filter(name => /^google[0-9a-f]{16}\.html$/.test(name));
  assert(files.length >= 1, 'Debe existir el archivo de verificación de Search Console en la raíz');
  for (const name of files) assert.equal(await read(name), 'google-site-verification: ' + name, name + ' debe tener exactamente el texto que pide Google (sin saltos de línea ni cambios)');
  assert(buildSite.includes('google[0-9a-f]{16}') && buildSite.includes('OUT + \'/\' + name'), 'El build publica el archivo de verificación en _site');
  console.log('Search Console: archivo de verificación ' + files.join(', ') + ' intacto y publicado por el build.');
}

// ---------------------------------------------------------------- Canales oficiales
{
  const page = await read('canales-oficiales.html');
  const handle = INSTAGRAM.replace('https://www.instagram.com/', '').replace(/\/$/, '');
  const phone = WHATSAPP.replace(/^1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
  assert.equal(handle, 'elite.scentsrd', 'El usuario oficial de Instagram');
  for (const text of [INSTAGRAM, '@' + handle, 'https://wa.me/' + WHATSAPP, phone, SITE_URL + '/', 'elitescentsrd.github.io']) assert(page.includes(text), 'La página de canales oficiales debe incluir ' + text);
  // Los datos de contacto de la página son los mismos que usa el resto del sitio (evita errores de tipeo).
  assert(template.includes(INSTAGRAM) && template.includes('https://wa.me/' + WHATSAPP) && template.includes('tel:+' + WHATSAPP));
  const links = [...page.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)].map(m => m[0]);
  for (const tag of links.filter(t => t.includes('target="_blank"'))) assert(tag.includes('rel="noopener noreferrer"'), 'Los enlaces externos usan rel="noopener noreferrer": ' + tag.slice(0, 60));
  assert(page.includes('content="index,follow"') && page.includes('rel="canonical" href="' + SITE_URL + '/canales-oficiales.html"'), 'La página se puede indexar y tiene su canonical');
  assert(/Content-Security-Policy/.test(page) && (page.match(/<script src=/g) || []).length === 1 && page.includes('<script src="/cookies.js">'), 'Solo carga cookies.js y tiene su política de seguridad');
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'WebPage'); assert.equal(ld.about['@id'], SITE_URL + '/#organization'); assert.equal(ld.isPartOf['@id'], SITE_URL + '/#website');
  assert(!/elite\.scents\.rd/i.test(page), 'La página no nombra cuentas de terceros');
  assert(!/(cuenta bancaria|número de cuenta|transferencia a)/i.test(page), 'La página no inventa datos de pago');
  // Se enlaza desde todos los pies de página públicos y se publica.
  for (const [name, html] of [['portada', template], ['página de perfume', renderProductPage(products[0], [])], ['pedidos y envíos', await read('pedidos-envios.html')], ['privacidad', await read('privacidad.html')]]) assert(html.includes('href="/canales-oficiales.html"'), 'El pie de página de ' + name + ' enlaza a los canales oficiales');
  assert(buildSite.includes("'canales-oficiales.html'"), 'El build publica canales-oficiales.html');
  assert((await read('scripts/build-catalog.mjs')).includes("path: 'canales-oficiales.html'") && (await read('sitemap.xml')).includes(SITE_URL + '/canales-oficiales.html'), 'Está en el sitemap');
  console.log('Canales oficiales: página, enlaces y datos de contacto correctos.');
}

// ---------------------------------------------------------------- Encuesta con cupón personal
{
  const S = await runUmd('survey.js'), Q = S.QUESTIONS;
  assert(Q.length >= 5 && Q.length <= 12, 'Entre 5 y 12 preguntas (la base de datos acepta hasta 12)');
  assert.equal(new Set(Q.map(q => q.id)).size, Q.length, 'Cada pregunta tiene un id distinto');
  for (const q of Q) {
    assert.match(q.id, /^[a-z_]{1,40}$/, 'id válido para la base de datos: ' + q.id);
    for (const o of q.options || []) assert(o.length <= 80, 'Opción de hasta 80 letras: ' + o);
    if (q.type === 'multi') assert(q.max && q.max <= 10, q.id + ': máximo de opciones');
    if (q.type === 'text' || q.type === 'longtext') assert(q.max && q.max <= 300, q.id + ': texto de hasta 300 letras');
  }
  assert(Q.filter(q => q.required).length >= 4, 'Al menos 4 preguntas obligatorias (la base de datos exige 4 respondidas)');
  const full = { para_quien: 'Para mí', aromas: ['Dulces', 'Dulces', 'Florales', 'Inventada', 'Frutales', 'Amaderados'], ocasion: 'Siempre', presupuesto: 'Menos de RD$3,000', favorito: '  Lattafa   Khamrah ', como_nos_conociste: 'Instagram', mejorar: '', otra: 'x' };
  const c = S.clean(full);
  assert.deepEqual(plain(c.missing), []);
  assert.deepEqual(plain(c.answers.aromas), ['Dulces', 'Florales', 'Frutales'], 'Varias opciones: sin repetidas, sin opciones inventadas y hasta el máximo');
  assert.equal(c.answers.favorito, 'Lattafa Khamrah', 'Texto recortado y sin espacios de más');
  assert(!('mejorar' in c.answers) && !('otra' in c.answers), 'No guarda respuestas vacías ni preguntas desconocidas');
  assert(JSON.stringify(c.answers).length < 3000, 'Cabe en el límite de la base de datos');
  assert.deepEqual(plain(S.clean({ para_quien: 'Otra cosa' }).missing), plain(Q.filter(q => q.required).map(q => q.id)), 'Detecta las obligatorias sin responder');
  const t = S.tally([{ answers: c.answers, created_at: '2026-09-23T10:00:00Z' }, { answers: { para_quien: 'Para regalar', aromas: ['Dulces'], mejorar: 'Más perfumes árabes' }, created_at: '2026-09-23T11:00:00Z' }]);
  const aromas = t.find(x => x.id === 'aromas'), dulces = aromas.options.find(o => o.label === 'Dulces');
  assert.equal(aromas.answered, 2); assert.equal(dulces.count, 2); assert.equal(dulces.percent, 100);
  assert.deepEqual(plain(t.find(x => x.id === 'mejorar').texts.map(x => x.text)), ['Más perfumes árabes']);
  const csv = S.toCsv([{ created_at: '2026-09-23T10:00:00Z', coupon_code: 'ES-ABCDEF', answers: { ...c.answers, favorito: '=HYPERLINK("http://x")', mejorar: 'Precios, "mejores"' } }]);
  assert(csv.startsWith('﻿'), 'El archivo para Excel lleva BOM (así se ven bien las tildes)');
  assert(csv.includes('"\'=HYPERLINK(""http://x"")"'), 'Un texto que empieza con = no se convierte en fórmula en Excel');
  assert(csv.includes('"Precios, ""mejores"""'), 'Comas y comillas escapadas');
  assert.equal(csv.trim().split('\r\n').length, 2, 'Encabezado y una fila');
  const page = await read('encuesta.html'), pageJs = await read('encuesta.js');
  assert(page.includes('<form method="post" id="surveyForm"') && page.includes('content="noindex,follow"'), 'La encuesta no se indexa en Google');
  assert(page.indexOf('/survey.js') > -1 && page.indexOf('/survey.js') < page.indexOf('/encuesta.js'), 'survey.js carga antes que encuesta.js');
  assert(pageJs.includes("'elite-survey-pending-v1'") && pageJs.includes("'/checkout.html?encuesta=1'") && pageJs.includes('rpc/survey_info'), 'La encuesta guarda las respuestas y lleva a la cuenta');
  assert(customerJs.includes("SURVEY_KEY='elite-survey-pending-v1'") && customerJs.includes('rpc/submit_survey') && customerJs.includes('rpc/my_survey_coupon'), 'Al entrar a la cuenta se envía la encuesta y se muestra el cupón');
  for (const id of ['surveyBox', 'surveyLoginNote']) assert(checkoutHtml.includes('id="' + id + '"'), 'checkout.html tiene #' + id);
  assert(template.includes('id="encuesta-promo" hidden') && template.includes('href="/encuesta.html"') && tiendaJs.includes('rpc/survey_info'), 'La portada muestra la promoción solo si la encuesta está activa');
  for (const id of ['survey-card', 'survey-form', 'survey-kpis', 'survey-results', 'survey-csv', 'survey-copy', 'survey-notice', 'survey-refresh']) assert(adminHtml.includes('id="' + id + '"'), 'El panel tiene #' + id);
  assert(adminHtml.indexOf('/survey.js') < adminHtml.indexOf('/admin.js'), 'survey.js carga antes que admin.js');
  assert(adminJs.includes('source=is.null') && adminJs.includes('/rest/v1/survey_responses?select=*&order=id.asc'), 'Los cupones de la encuesta no llenan la lista de cupones y las respuestas entran en el respaldo');
  for (const f of ['encuesta.html', 'encuesta.js', 'survey.js']) assert(buildSite.includes("'" + f + "'"), f + ' se publica');
  assert(!(await read('sitemap.xml')).includes('encuesta'), 'La encuesta no va al sitemap');
  assert((await read('privacidad.html')).includes('Encuesta de clientes'), 'La política de privacidad explica la encuesta');
  const sql = (await read('supabase/migrations/20260923120000_encuesta.sql')).replace(/^--.*$/gm, '');
  assert(/revoke all on function public\.submit_survey\(jsonb, text\) from public, anon/i.test(sql) && /grant execute on function public\.submit_survey\(jsonb, text\) to authenticated/i.test(sql), 'Solo con sesión se envía la encuesta');
  assert(/drop function if exists public\.submit_survey\(jsonb\);/i.test(sql), 'La versión vieja de submit_survey se borra (evita que haya dos y Supabase no sepa cuál usar)');
  // Uno por persona: dispositivo, cédula o teléfono, y conexión (IP cifrada), también al pagar.
  assert(/'dispositivo'/.test(sql) && /'identidad'/.test(sql) && /'conexion'/.test(sql) && /survey_ip_days/.test(sql), 'Revisa dispositivo, identidad y conexión');
  assert(/encode\(sha256\(/.test(sql) && /ip_pepper/.test(sql) && !/ip_hash\s*text\s*,?\s*--.*texto/i.test(sql), 'La IP se guarda cifrada con una clave secreta propia');
  assert(/cf-connecting-ip/.test(sql) && /split_part\(coalesce\(\w+ ->> 'x-forwarded-for', ''\), ',', 1\)/.test(sql), 'IP según Cloudflare o la primera de x-forwarded-for (lo que recomienda Supabase)');
  assert(/set_masklen\(v_addr, 64\)/.test(sql) && /::ffff:0\.0\.0\.0\/96/.test(sql), 'IPv6: se agrupa por la red de la casa (/64); las IPv4 escritas como IPv6 cuentan como IPv4');
  assert(/when v_c\.source = 'encuesta' and private\.survey_identity_used\(p_uid\)/.test(sql), 'Al pagar se revisa otra vez la cédula y el teléfono');
  assert(/alter table public\.survey_blocks enable row level security/i.test(sql) && /revoke all on public\.survey_blocks from anon, authenticated/i.test(sql), 'La lista de bloqueos solo la ve el administrador');
  assert(/revoke all on private\.app_secrets from public, anon, authenticated/i.test(sql), 'La clave secreta no la lee nadie de afuera');
  assert(customerJs.includes("localStorage.getItem('elite-device-id-v1')") && customerJs.includes('p_device:deviceId()'), 'La cuenta envía el identificador al azar del navegador');
  assert(customerJs.includes('if(r.blocked||'), 'Si se bloquea por repetido, no se vuelve a intentar en cada entrada');
  assert(adminHtml.includes('name="survey_ip_days"') && adminJs.includes('survey_ip_days: Number(') && adminJs.includes("/rest/v1/survey_blocks?select=reason,created_at"), 'El panel ajusta los días de la conexión y muestra los bloqueos');
  assert(adminJs.includes("/^ES-/.test(code)"), 'Los códigos ES- quedan reservados para la encuesta');
  assert(!adminJs.includes("survey_responses?select=*&order=created_at.desc"), 'El panel no descarga las huellas (IP cifrada, dispositivo) para mostrar resultados');
  const privacy = await read('privacidad.html');
  assert(privacy.includes('identificador al azar de tu navegador') && privacy.includes('versión cifrada de tu dirección IP'), 'La privacidad explica cómo se evita el abuso');
  assert(/grant execute on function public\.survey_info\(\) to anon, authenticated/i.test(sql), 'La información pública de la encuesta la ve cualquiera');
  assert(/alter table public\.survey_responses enable row level security/i.test(sql) && /revoke all on public\.survey_responses from anon, authenticated/i.test(sql), 'Respuestas con RLS');
  assert(/v_c\.user_id is not null and v_c\.user_id is distinct from p_uid/.test(sql), 'Un cupón personal solo lo usa su dueño');
  assert(/gen_random_uuid\(\)/.test(sql) && /pg_advisory_xact_lock/.test(sql), 'Código al azar y sin duplicados por envíos simultáneos');
  console.log('Encuesta: preguntas, limpieza, resultados, Excel, página, carrito, panel y migración correctos.');
}
console.log('Pruebas de funciones nuevas superadas.');
