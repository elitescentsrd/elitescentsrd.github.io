import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { SITE_URL, productPath, productUrl, absoluteUrl, brandSchemaScript } from './lib/seo.mjs';
const USD_RATE_DOP = 63;
// Se pide select=* (funciona aunque una migración de columnas aún no se haya aplicado) y se publican solo estos campos.
const PUBLIC_FIELDS = ['id', 'name', 'price', 'size', 'gender', 'image_url', 'sort_order', 'availability', 'brand', 'notes_top', 'notes_heart', 'notes_base', 'gallery_urls', 'description', 'original_price', 'offer_label', 'offer_ends_at'];
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
const products = databaseProducts.map(({ page, slot, ...rest }) => {
  const product = Object.fromEntries(PUBLIC_FIELDS.filter(k => rest[k] !== undefined).map(k => [k, rest[k]]));
  positions[product.id] = { page, slot };
  const extra = enrichment[String(product.id)];
  return extra ? { ...product, notes_top: extra.notes_top, notes_heart: extra.notes_heart, notes_base: extra.notes_base } : product;
});
await writeFile('data/product-positions.json', JSON.stringify(positions, null, 1) + '\n');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nums = value => (String(value).match(/[0-9][0-9,.]*/g) || []).map(v => Number(v.replace(/[,.]/g, ''))).filter(Number.isFinite);
const gender = { hombre: 'Hombre', mujer: 'Mujer', unisex: 'Unisex' };
const status = { disponible: 'Disponible', agotado: 'Agotado', encargo: 'Solo por encargo' };
const schemaAvailability = { disponible: 'https://schema.org/InStock', agotado: 'https://schema.org/OutOfStock', encargo: 'https://schema.org/PreOrder' };
// Solo devuelve una URL de imagen individual real. A propósito NO cae a la
// lámina completa de /pages/: esa lámina muestra hasta 12 productos distintos
// y jamás debe declararse como la foto de un producto en datos estructurados
// (ver hallazgo de la auditoría sobre JSON-LD e imágenes de producto).
// Foto válida: HTTPS (p. ej. Supabase Storage) o una foto del propio sitio en /img/productos/. Nunca una lámina.
const validImage = url => typeof url === 'string' && !/\/pages\/page-/i.test(url) && (/^https:\/\//i.test(url) || /^\/img\/productos\/[0-9]{4,}-[a-z0-9-]+\.(jpe?g|png|webp)$/i.test(url));
const absolute = url => url.startsWith('/') ? SITE_URL + url : url;
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
for (const p of products) {
  p.description = p.description || describe(p);
  p.image_url = imageUrl(p) || localPhotos.get(Number(p.id)) || null;
  p.gallery_urls = (p.gallery_urls || []).filter(validImage);
}
const description = p => p.description || describe(p);
const usdPrice = p => {
  const value = nums(p.price)[0];
  return value ? 'US$' + Math.round(value / USD_RATE_DOP) + ' aprox.' : '';
};
const whatsapp = p => 'https://wa.me/18094333348?text=' + encodeURIComponent('Hola Elite Scents RD, me interesa: ' + p.name + ' (' + (p.size || 'tamaño por confirmar') + ', ' + (p.price || 'precio por confirmar') + '). ¿Puedes ayudarme?');

// Solo las primeras EAGER_CARDS tarjetas cargan su foto al abrir la página (las mismas que muestra tienda.js al inicio).
// Las demás guardan la ruta en data-bg: así el navegador no descarga las 420 fotos (~20 MB) antes de que el JavaScript
// deje solo 24 tarjetas en pantalla; el JSON-LD y el JSON precargado conservan todas las fotos para buscadores.
const EAGER_CARDS = 24;
// Las tarjetas usan una miniatura WebP (img/productos/thumbs/, ~8 KB); la ficha y el JSON-LD usan la foto completa.
const thumbOf = url => /^\/img\/productos\/[^/]+\.(jpe?g|png)$/i.test(url) ? url.replace('/img/productos/', '/img/productos/thumbs/').replace(/\.(jpe?g|png)$/i, '.webp') : url;
function visual(p, index = 0) {
  if (imageUrl(p)) {
    const label = esc('Frasco de ' + p.name + (p.brand ? ' de ' + p.brand : ''));
    return index < EAGER_CARDS
      ? '<div class="photo custom" role="img" aria-label="' + label + '" style="background-image:url(&quot;' + esc(thumbOf(p.image_url)) + '&quot;);background-size:contain;background-position:center"></div>'
      : '<div class="photo custom" role="img" aria-label="' + label + '" data-bg="' + esc(thumbOf(p.image_url)) + '"></div>';
  }
  // Sin foto propia: placeholder neutro. Nunca se recorta una lámina del catálogo original.
  return '<div class="photo placeholder" role="img" aria-label="' + esc('Foto próximamente de ' + p.name) + '"></div>';
}
function card(p, index) {
  const availability = status[p.availability] ? p.availability : 'disponible';
  const notes = [...(p.notes_top || []), ...(p.notes_heart || []), ...(p.notes_base || [])].slice(0,3).join(' · ') || (gender[p.gender] || 'Unisex');
  return '<article class="perfume" id="producto-' + esc(p.id) + '" data-product-id="' + esc(p.id) + '">' +
    visual(p, index) + '<span class="stock stock-' + availability + '">' + status[availability] + '</span>' + (p.original_price ? '<span class="offer-badge">OFERTA' + (p.offer_label ? ' · ' + esc(p.offer_label) : '') + '</span>' : '') +
    '<div class="meta"><span>' + esc(p.brand || gender[p.gender] || 'Perfume') + '</span><span>' + esc(p.size || '') + '</span></div>' +
    '<h3><a href="' + esc(productPath(p)) + '">' + esc(p.name) + '</a></h3><div class="size">' + esc(notes) + '</div><div class="price' + (p.original_price ? ' price-offer' : '') + '">' + (p.original_price ? '<small class="price-was">Antes <s>' + esc(p.original_price) + '</s></small>' : '') + '<strong>' + (p.original_price ? 'Ahora ' : '') + esc(p.price || 'Precio a confirmar') + '</strong><small>' + esc(usdPrice(p)) + '</small></div>' +
    '<div class="card-actions"><button type="button" data-open-product="' + esc(p.id) + '">Ver detalles</button><a href="' + esc(whatsapp(p)) + '" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a></div></article>';
}
function schema(p) {
  const value = nums(p.price)[0];
  // Solo URLs HTTPS reales (foto individual + galería); nunca la lámina
  // completa. Si el producto todavía no tiene foto propia, se omite el campo
  // "image" en vez de inventar una imagen que no le pertenece.
  const images = [imageUrl(p), ...(p.gallery_urls || [])].filter(validImage).map(absolute).slice(0, 3);
  const data = {
    '@context':'https://schema.org','@type':'Product',
    name:p.name,
    description:description(p),
    brand:{'@type':'Brand',name:p.brand || 'Elite Scents RD'},
    offers:{'@type':'Offer',price:value ? String(value) : undefined,priceCurrency:'DOP',priceValidUntil:p.original_price && p.offer_ends_at ? String(p.offer_ends_at).slice(0, 10) : undefined,availability:schemaAvailability[p.availability] || schemaAvailability.disponible,url:productUrl(p)}
  };
  if (images.length) data.image = images;
  return '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '<\/script>';
}

const catalog = '<!-- PRODUCT_CATALOG_START -->\n<div id="productGrid" class="grid" aria-busy="false">\n' + products.map(card).join('\n') + '\n</div>\n' +
  '<script type="application/json" id="preRenderedProducts">' + JSON.stringify(products).replace(/</g, '\\u003c') + '<\/script>\n<!-- PRODUCT_CATALOG_END -->';
const schemas = '<!-- PRODUCT_JSON_LD_START -->\n' + products.map(schema).join('\n') + '\n<!-- PRODUCT_JSON_LD_END -->';
const output = template
  .replace(/<!-- PRODUCT_CATALOG_START -->[\s\S]*?<!-- PRODUCT_CATALOG_END -->/, catalog)
  .replace(/<!-- PRODUCT_JSON_LD_START -->[\s\S]*?<!-- PRODUCT_JSON_LD_END -->/, schemas)
  .replace('<!-- BRAND_JSON_LD -->', brandSchemaScript());
await writeFile('index.html', output);

// Regenera sitemap.xml en cada build: la portada cambia con el catálogo, así
// que su lastmod es siempre la fecha del build. Las páginas estáticas
// conservan la fecha de su último cambio real de contenido; actualízala a
// mano en STATIC_PAGES cuando edites privacidad.html o pedidos-envios.html.
const today = new Date().toISOString().slice(0, 10);
const STATIC_PAGES = [
  { path: 'pedidos-envios.html', lastmod: '2026-09-20', changefreq: 'monthly', priority: '0.6' },
  { path: 'privacidad.html', lastmod: '2026-09-21', changefreq: 'yearly', priority: '0.3' },
  { path: 'canales-oficiales.html', lastmod: '2026-09-21', changefreq: 'yearly', priority: '0.4' },
];
const sitemapUrl = (loc, lastmod, changefreq, priority) =>
  '  <url><loc>' + SITE_URL + loc + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>' + changefreq + '</changefreq><priority>' + priority + '</priority></url>';
// Una entrada por perfume (con su foto para Google Imágenes).
const productEntries = products.map(p => '  <url><loc>' + esc(productUrl(p)) + '</loc><lastmod>' + today + '</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>' +
  (p.image_url ? '<image:image><image:loc>' + esc(absoluteUrl(p.image_url)) + '</image:loc><image:title>' + esc(p.name) + '</image:title></image:image>' : '') + '</url>');
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
  sitemapUrl('/', today, 'weekly', '1.0') + '\n' +
  STATIC_PAGES.map(p => sitemapUrl('/' + p.path, p.lastmod, p.changefreq, p.priority)).join('\n') + '\n' +
  productEntries.join('\n') + '\n' +
  '</urlset>\n';
await writeFile('sitemap.xml', sitemap);

console.log('Catálogo pre-renderizado: ' + products.length + ' productos con JSON-LD.');
console.log('sitemap.xml actualizado (lastmod de portada: ' + today + ').');
