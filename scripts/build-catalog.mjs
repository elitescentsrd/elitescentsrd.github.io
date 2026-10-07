import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { SITE_URL, productPath, productUrl, absoluteUrl, brandSchemaScript, ratingOf, ratingText, reviewCardHtml, reviewSummaryHtml, MEDICION, cspWithMeasurement } from './lib/seo.mjs';
const USD_RATE_DOP = 63;
// Se pide select=* (funciona aunque una migración de columnas aún no se haya aplicado) y se publican solo estos campos.
const PUBLIC_FIELDS = ['id', 'name', 'price', 'size', 'gender', 'image_url', 'sort_order', 'availability', 'brand', 'notes_top', 'notes_heart', 'notes_base', 'gallery_urls', 'description', 'original_price', 'offer_label', 'offer_ends_at', 'inspired_by', 'stock_left'];
const template = await readFile('src/index.template.html', 'utf8');
const enrichment = JSON.parse(await readFile('data/product-enrichment.json', 'utf8'));
const config = await readFile('supabase-config.js', 'utf8');
const url = config.match(/url:\s*['"]([^'"]+)['"]/)?.[1];
const key = process.env.SUPABASE_PUBLISHABLE_KEY || config.match(/publishableKey:\s*['"]([^'"]+)['"]/)?.[1];
if (!url || !key) throw new Error('No se encontró la configuración pública de Supabase.');

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);
const endpoint = url.replace(/\/$/, '') + '/rest/v1/products?select=*&active=eq.true&order=sort_order.asc,id.asc&limit=1000';
const response = await fetch(endpoint, { headers: { apikey: key }, signal: controller.signal });
clearTimeout(timer);
if (!response.ok) throw new Error('Supabase respondió HTTP ' + response.status);
const databaseProducts = await response.json();
if (!Array.isArray(databaseProducts) || databaseProducts.length === 0) throw new Error('El catálogo llegó vacío; se conserva el despliegue anterior.');
// page/slot son datos internos de la auditoría de precios: se guardan aparte
// en data/product-positions.json (que nunca se publica) y no llegan al HTML
// ni al JSON público del catálogo.
const positions = {};
// «Nuevos»: perfumes agregados después de la carga inicial del catálogo (el día en que se creó la mayoría), de los últimos 90 días.
// created_at no se publica: solo se usa aquí para elegir los números de perfume de la sección.
function newArrivals(rows, now = Date.now()) {
  const day = row => String(row.created_at || '').slice(0, 10);
  const perDay = new Map();
  for (const row of rows) if (day(row)) perDay.set(day(row), (perDay.get(day(row)) || 0) + 1);
  const bulk = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return rows.filter(row => bulk && day(row) > bulk && now - Date.parse(row.created_at) < 90 * 864e5 && row.availability !== 'agotado')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || a.sort_order - b.sort_order || a.id - b.id)
    .slice(0, 12).map(row => Number(row.id));
}
// «Lo más vendido»: la base de datos devuelve solo números de perfume (nunca pedidos ni clientes). Si todavía no existe
// la función o hay pocas ventas, la sección no se muestra.
async function bestSellers() {
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/best_sellers', { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_days: 120, p_limit: 12 }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows.map(row => Number(row.product_id)).filter(Number.isFinite) : [];
  } catch { return []; }
}
const products = databaseProducts.map(({ page, slot, ...rest }) => {
  // stock_left («¡Quedan…!») solo cuando hay cantidad baja: así el archivo no crece con un null por perfume.
  const product = Object.fromEntries(PUBLIC_FIELDS.filter(k => rest[k] !== undefined && !(k === 'stock_left' && rest[k] === null)).map(k => [k, rest[k]]));
  positions[product.id] = { page, slot };
  const extra = enrichment[String(product.id)];
  return extra ? { ...product, notes_top: extra.notes_top, notes_heart: extra.notes_heart, notes_base: extra.notes_base } : product;
});
await writeFile('data/product-positions.json', JSON.stringify(positions, null, 1) + '\n');
const visibleIds = new Set(products.map(p => Number(p.id)));
const soldIds = (await bestSellers()).filter(id => visibleIds.has(id));
const homeSections = { vendidos: soldIds.length >= 4 ? soldIds : [], nuevos: newArrivals(databaseProducts) };

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nums = value => (String(value).match(/[0-9][0-9,.]*/g) || []).map(v => Number(v.replace(/[,.]/g, ''))).filter(Number.isFinite);
const gender = { hombre: 'Hombre', mujer: 'Mujer', unisex: 'Unisex' };
const status = { disponible: 'Disponible', agotado: 'Agotado', encargo: 'Solo por encargo' };
// «¡Quedan 2!»: solo si el dueño lleva la cantidad en casa y quedan de 1 a 3 (la base de datos nunca publica más).
const stockText = p => { const n = Number(p.stock_left); return p.availability === 'disponible' && Number.isInteger(n) && n >= 1 && n <= 3 ? (n === 1 ? '¡Queda 1!' : '¡Quedan ' + n + '!') : ''; };
// La base de datos ya tiene la columna stock_left (script del 3 de octubre): la tienda la pide al día en cada visita.
const stockTracked = databaseProducts.some(row => Object.prototype.hasOwnProperty.call(row, 'stock_left'));
// Solo devuelve una URL de imagen individual real. A propósito NO cae a la
// lámina completa de /pages/: esa lámina muestra hasta 12 productos distintos
// y jamás debe declararse como la foto de un producto en datos estructurados
// (ver hallazgo de la auditoría sobre JSON-LD e imágenes de producto).
// Foto válida: HTTPS (p. ej. Supabase Storage) o una foto del propio sitio en /img/productos/. Nunca una lámina.
const validImage = url => typeof url === 'string' && !/\/pages\/page-/i.test(url) && (/^https:\/\//i.test(url) || /^\/img\/productos\/[0-9]{4,}-[a-z0-9-]+\.(jpe?g|png|webp)$/i.test(url));
const imageUrl = p => validImage(p.image_url) ? p.image_url : null;
// Fotos individuales guardadas en el repositorio: img/productos/<ID con 4 dígitos>-<nombre>.jpg.
// Una foto subida por el panel (image_url en Supabase) tiene prioridad; estas cubren a los demás productos.
const localPhotos = new Map();
if (existsSync('img/productos')) {
  for (const file of await readdir('img/productos')) {
    const match = /^([0-9]{4,})-[a-z0-9-]+\.(jpe?g|png|webp)$/i.exec(file);
    if (match) localPhotos.set(Number(match[1]), '/img/productos/' + file);
  }
}
// Descripción propia de cada perfume, armada solo con datos verificados (marca, género, tamaño y notas olfativas).
// Una descripción escrita a mano en el panel (columna description) tiene prioridad.
const listText = items => items.slice(0, 3).map(item => String(item).toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' y $1');
function describe(p) {
  const who = { hombre: 'para hombre', mujer: 'para mujer', unisex: 'unisex' }[p.gender] || '';
  const top = p.notes_top || [], heart = p.notes_heart || [], base = p.notes_base || [];
  const parts = [p.name + ' es una fragancia' + (who ? ' ' + who : '') + (p.brand ? ' de ' + p.brand : '') + (p.size ? ', en presentación de ' + p.size : '') + '.'];
  if (top.length) parts.push('Abre con notas de ' + listText(top) + (heart.length ? ', se desarrolla con ' + listText(heart) : '') + (base.length ? ' y se asienta en un fondo de ' + listText(base) : '') + '.');
  parts.push('Consulta disponibilidad y tiempo de entrega por WhatsApp antes de ordenar.');
  return parts.join(' ');
}
// Defensa en profundidad: una URL de lámina (o no válida) en la base nunca llega al HTML público.
// Versión WebP de la foto local (img/productos/webp/, ~60% más liviana): la usan la ficha y la página del perfume;
// Google, Meta y la lista de precios siguen usando el JPG.
const webpOf = url => {
  const m = /^\/img\/productos\/([^/]+)\.(jpe?g|png)$/i.exec(url || '');
  return m && existsSync('img/productos/webp/' + m[1] + '.webp') ? '/img/productos/webp/' + m[1] + '.webp' : null;
};
for (const p of products) {
  p.description = p.description || describe(p);
  p.image_url = imageUrl(p) || localPhotos.get(Number(p.id)) || null;
  p.gallery_urls = (p.gallery_urls || []).filter(validImage);
  const webp = webpOf(p.image_url);
  if (webp) p.image_webp = webp; else delete p.image_webp;
}
// Reseñas verificadas publicadas (script «MENSAJES Y RESEÑAS» del 7 de octubre). La base de datos solo deja leer las que
// la tienda publicó y solo nombre, estrellas, comentario y fecha (nunca el pedido ni el cliente). Sin la tabla, no hay
// reseñas y todo funciona igual. El promedio y la cantidad van en perfumes.json (tarjetas y ficha); las reseñas completas,
// en data/resenas.json para las páginas de cada perfume (ese archivo no se guarda en Git: las reseñas son de los clientes).
async function publishedReviews() {
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/product_reviews?select=id,product_id,author_name,rating,comment,created_at&order=created_at.desc,id.desc&limit=5000', { headers: { apikey: key }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
const reviewsById = new Map();
for (const r of await publishedReviews()) {
  const id = Number(r.product_id), rating = Number(r.rating), author = String(r.author_name || '').trim();
  if (!visibleIds.has(id) || !Number.isInteger(rating) || rating < 1 || rating > 5 || author.length < 2) continue;
  if (!reviewsById.has(id)) reviewsById.set(id, []);
  reviewsById.get(id).push({ product_id: id, author: author.slice(0, 40), rating, comment: String(r.comment || '').trim().slice(0, 600), date: String(r.created_at || '').slice(0, 10) });
}
for (const p of products) {
  const list = reviewsById.get(Number(p.id));
  if (list) { p.rating_avg = ratingOf(list); p.rating_count = list.length; } else { delete p.rating_avg; delete p.rating_count; }
}
await writeFile('data/resenas.json', JSON.stringify(Object.fromEntries(reviewsById)) + '\n');
const allReviews = [...reviewsById.values()].flat().sort((a, b) => b.date.localeCompare(a.date));
const ratingLine = p => p.rating_count ? '<p class="card-rating"><span aria-hidden="true"><b>★</b> ' + ratingText(p.rating_avg) + ' <small>(' + p.rating_count + ')</small></span><span class="sr-only">' + ratingText(p.rating_avg) + ' de 5 estrellas en ' + p.rating_count + (p.rating_count === 1 ? ' opinión' : ' opiniones') + '</span></p>' : '';
const usdPrice = p => {
  const value = nums(p.price)[0];
  return value ? 'US$' + Math.round(value / USD_RATE_DOP) + ' aprox.' : '';
};
const whatsapp = p => 'https://wa.me/18094333348?text=' + encodeURIComponent('Hola Elite Scents RD, me interesa: ' + p.name + ' (' + (p.size || 'tamaño por confirmar') + ', ' + (p.price || 'precio por confirmar') + '). ¿Puedes ayudarme?');

// La portada trae listas solo las primeras FIRST_CARDS tarjetas (las mismas que muestra tienda.js al inicio); el resto del
// catálogo va en /perfumes.json. Cada perfume tiene su página con su ficha para Google, y /perfumes/ los enlaza todos.
const FIRST_CARDS = 24;
// Las tarjetas usan una miniatura WebP (img/productos/thumbs/, ~7 KB) con carga diferida: el celular la baja al acercarse.
const thumbOf = url => /^\/img\/productos\/[^/]+\.(jpe?g|png)$/i.test(url) ? url.replace('/img/productos/', '/img/productos/thumbs/').replace(/\.(jpe?g|png)$/i, '.webp') : url;
function visual(p) {
  if (imageUrl(p)) {
    const alt = esc('Frasco de ' + p.name + (p.brand ? ' de ' + p.brand : ''));
    return '<div class="photo custom"><img src="' + esc(thumbOf(p.image_url)) + '" alt="' + alt + '" width="420" height="420" loading="lazy" decoding="async"></div>';
  }
  // Sin foto propia: placeholder neutro. Nunca se recorta una lámina del catálogo original.
  return '<div class="photo placeholder" role="img" aria-label="' + esc('Foto próximamente de ' + p.name) + '"></div>';
}
// En las secciones destacadas la tarjeta no lleva id (el id de cada perfume es el de su tarjeta del catálogo).
function card(p, shelf = false) {
  const availability = status[p.availability] ? p.availability : 'disponible';
  const notes = [...(p.notes_top || []), ...(p.notes_heart || []), ...(p.notes_base || [])].slice(0,3).join(' · ') || (gender[p.gender] || 'Unisex');
  return '<article class="perfume"' + (shelf ? ' role="listitem"' : ' id="producto-' + esc(p.id) + '"') + ' data-product-id="' + esc(p.id) + '">' +
    visual(p) + '<span class="stock stock-' + availability + (stockText(p) ? ' stock-low' : '') + '">' + (stockText(p) || status[availability]) + '</span>' + (p.original_price ? '<span class="offer-badge">OFERTA' + (p.offer_label ? ' · ' + esc(p.offer_label) : '') + '</span>' : '') +
    '<div class="meta"><span>' + esc(p.brand || gender[p.gender] || 'Perfume') + '</span><span>' + esc(p.size || '') + '</span></div>' +
    '<h3><a href="' + esc(productPath(p)) + '">' + esc(p.name) + '</a></h3>' + ratingLine(p) + (p.inspired_by ? '<p class="inspired">Inspirado en <span>' + esc(p.inspired_by) + '</span></p>' : '') + '<div class="size">' + esc(notes) + '</div><div class="price' + (p.original_price ? ' price-offer' : '') + '">' + (p.original_price ? '<small class="price-was">Antes <s>' + esc(p.original_price) + '</s></small>' : '') + '<strong>' + (p.original_price ? 'Ahora ' : '') + esc(p.price || 'Precio a confirmar') + '</strong><small>' + esc(usdPrice(p)) + '</small></div>' +
    (availability === 'agotado' || availability === 'encargo' ? '<button type="button" class="notify-link" data-notify-product="' + esc(p.id) + '">🔔 Avísame cuando llegue</button>' : '') +
    '<div class="card-actions"><button type="button" data-open-product="' + esc(p.id) + '">Ver detalles</button><a href="' + esc(whatsapp(p)) + '" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a></div></article>';
}
// Catálogo público completo (los mismos campos de siempre) en /perfumes.json: se pide desde el <head> en paralelo
// y el navegador lo guarda; el nombre lleva una versión para que un cambio de precio nunca muestre datos viejos.
const catalogJson = JSON.stringify(products).replace(/</g, '\\u003c');
const catalogVersion = createHash('sha1').update(catalogJson).digest('hex').slice(0, 12);
const catalogSrc = '/perfumes.json?v=' + catalogVersion;
await writeFile('perfumes.json', catalogJson + '\n');

// Secciones destacadas ya armadas en la portada (mismas reglas que tienda.js): se ven al instante y no mueven la página.
const byId = new Map(products.map(p => [Number(p.id), p]));
const offerPercent = p => { const was = nums(p.original_price)[0], now = nums(p.price)[0]; return was && now ? 1 - now / was : 0; };
const shelves = {
  vendidos: homeSections.vendidos.map(id => byId.get(id)).filter(Boolean).slice(0, 12),
  ofertas: products.filter(p => p.original_price).sort((a, b) => offerPercent(b) - offerPercent(a)).slice(0, 12),
  nuevos: homeSections.nuevos.map(id => byId.get(id)).filter(Boolean).slice(0, 12),
};
const SHELF_MIN = { vendidos: 4, ofertas: 3, nuevos: 3 };
let html = template;
let shelvesShown = 0;
for (const kind of ['vendidos', 'ofertas', 'nuevos']) {
  const items = shelves[kind], show = items.length >= SHELF_MIN[kind];
  const at = html.indexOf('data-shelf="' + kind + '" hidden>');
  if (at < 0) throw new Error('Falta la sección ' + kind + ' en la plantilla.');
  const row = html.indexOf('<!-- SHELF_ROW -->', at);
  html = html.slice(0, row) + (show ? items.map(p => card(p, true)).join('') : '') + html.slice(row + '<!-- SHELF_ROW -->'.length);
  if (show) { html = html.replace('data-shelf="' + kind + '" hidden>', 'data-shelf="' + kind + '">'); shelvesShown++; }
}
if (shelvesShown) html = html.replace('id="destacados" aria-label="Destacados de la tienda" hidden>', 'id="destacados" aria-label="Destacados de la tienda">');
// Cinta de marcas de la portada: las marcas con más perfumes (al tocar una, el catálogo se filtra por esa marca). Va dos
// veces seguidas para que el movimiento no tenga corte; la copia no la leen los lectores de pantalla ni recibe el foco.
const brandCount = new Map();
for (const p of products) if (p.brand && !/^sets?$/i.test(p.brand.trim())) brandCount.set(p.brand, (brandCount.get(p.brand) || 0) + 1); // «Sets» (estuches) no es una marca
const topBrands = [...brandCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).slice(0, 16).map(([brand]) => brand);
const brandItem = (brand, copy) => '<li><button type="button" data-brand="' + esc(brand) + '"' + (copy ? ' tabindex="-1"' : '') + '>' + esc(brand) + '</button></li>';
if (!html.includes('<!-- BRAND_MARQUEE -->') || !html.includes('<!-- BRAND_MARQUEE_COPY -->')) throw new Error('Falta la cinta de marcas en la plantilla.');
html = html.replace('<!-- BRAND_MARQUEE -->', topBrands.map(brand => brandItem(brand)).join('')).replace('<!-- BRAND_MARQUEE_COPY -->', topBrands.map(brand => brandItem(brand, true)).join(''));
if (topBrands.length < 4) html = html.replace('<section class="brand-strip" id="marcas"', '<section class="brand-strip" id="marcas" hidden');
// Opiniones de la portada: el promedio de todas las reseñas publicadas y las 6 más recientes que traen comentario (sean
// de las estrellas que sean). Sin reseñas, queda el aviso de siempre.
if (!/<!-- REVIEWS_HOME_START -->[\s\S]*<!-- REVIEWS_HOME_END -->/.test(html)) throw new Error('Falta la sección de opiniones en la plantilla.');
const homeReviews = allReviews.filter(r => r.comment).slice(0, 6);
if (allReviews.length) html = html.replace(/<!-- REVIEWS_HOME_START -->[\s\S]*<!-- REVIEWS_HOME_END -->/, '<!-- REVIEWS_HOME_START -->' + reviewSummaryHtml(allReviews, 'de clientes que recibieron su pedido') +
  (homeReviews.length ? '<ul class="review-list review-grid">' + homeReviews.map(r => reviewCardHtml(r, byId.get(r.product_id))).join('') + '</ul>' : '') + '<!-- REVIEWS_HOME_END -->');

const catalog = '<!-- PRODUCT_CATALOG_START -->\n<div id="productGrid" class="grid" aria-busy="false">\n' + products.slice(0, FIRST_CARDS).map(p => card(p)).join('\n') + '\n</div>\n' +
  '<script type="application/json" id="catalogInfo">' + JSON.stringify({ src: catalogSrc, total: products.length, ...(stockTracked ? { stock: true } : {}) }) + '<\/script>\n' +
  '<script type="application/json" id="homeSections">' + JSON.stringify(homeSections) + '<\/script>\n<!-- PRODUCT_CATALOG_END -->';
// Medición de Google y Meta (solo si está activa en cookies.js): medicion.js y su política de seguridad.
if (MEDICION.active) {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/;
  if (!csp.test(html) || !html.includes('<script defer src="/analytics.js"></script>')) throw new Error('La plantilla perdió la política de seguridad o analytics.js.');
  html = html.replace(csp, (all, policy) => '<meta http-equiv="Content-Security-Policy" content="' + cspWithMeasurement(policy) + '">')
    .replace('<script defer src="/analytics.js"></script>', '<script defer src="/analytics.js"></script>' + MEDICION.tag);
}
const output = html
  .replace(/<!-- PRODUCT_CATALOG_START -->[\s\S]*?<!-- PRODUCT_CATALOG_END -->/, catalog)
  .replace('<!-- CATALOG_PRELOAD -->', '<link rel="preload" href="' + catalogSrc + '" as="fetch" type="application/json" crossorigin="anonymous">')
  .replace('<!-- BRAND_JSON_LD -->', brandSchemaScript());
await writeFile('index.html', output);

// Regenera sitemap.xml en cada build: la portada cambia con el catálogo, así
// que su lastmod es siempre la fecha del build. Las páginas estáticas
// conservan la fecha de su último cambio real de contenido; actualízala a
// mano en STATIC_PAGES cuando edites privacidad.html o pedidos-envios.html.
const today = new Date().toISOString().slice(0, 10);
const STATIC_PAGES = [
  { path: 'pedidos-envios.html', lastmod: '2026-10-03', changefreq: 'monthly', priority: '0.6' },
  { path: 'privacidad.html', lastmod: '2026-10-07', changefreq: 'yearly', priority: '0.3' },
  { path: 'canales-oficiales.html', lastmod: '2026-10-07', changefreq: 'yearly', priority: '0.4' },
  { path: 'contacto.html', lastmod: '2026-10-07', changefreq: 'yearly', priority: '0.5' },
  { path: 'aviso-legal.html', lastmod: '2026-10-03', changefreq: 'yearly', priority: '0.3' },
];
const sitemapUrl = (loc, lastmod, changefreq, priority) =>
  '  <url><loc>' + SITE_URL + loc + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>' + changefreq + '</changefreq><priority>' + priority + '</priority></url>';
// Una entrada por perfume (con su foto para Google Imágenes).
const productEntries = products.map(p => '  <url><loc>' + esc(productUrl(p)) + '</loc><lastmod>' + today + '</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>' +
  (p.image_url ? '<image:image><image:loc>' + esc(absoluteUrl(p.image_url)) + '</image:loc><image:title>' + esc(p.name) + '</image:title></image:image>' : '') + '</url>');
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
  sitemapUrl('/', today, 'weekly', '1.0') + '\n' +
  sitemapUrl('/perfumes/', today, 'weekly', '0.8') + '\n' +
  STATIC_PAGES.map(p => sitemapUrl('/' + p.path, p.lastmod, p.changefreq, p.priority)).join('\n') + '\n' +
  productEntries.join('\n') + '\n' +
  '</urlset>\n';
await writeFile('sitemap.xml', sitemap);

console.log('Catálogo: ' + products.length + ' perfumes en perfumes.json; portada con ' + Math.min(FIRST_CARDS, products.length) + ' tarjetas y ' + shelvesShown + ' secciones destacadas.');
console.log('Portada: ' + homeSections.vendidos.length + ' más vendidos, ' + homeSections.nuevos.length + ' nuevos.');
console.log('Reseñas publicadas: ' + allReviews.length + ' de ' + reviewsById.size + ' perfumes.');
console.log('sitemap.xml actualizado (lastmod de portada: ' + today + ').');
