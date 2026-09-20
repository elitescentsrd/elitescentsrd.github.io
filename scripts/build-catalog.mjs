import { readFile, writeFile } from 'node:fs/promises';

const SITE_URL = 'https://elitescentsrd.github.io';
const USD_RATE_DOP = 63;
const FIELDS = 'id,name,price,size,gender,page,slot,image_url,sort_order,availability,brand,notes_top,notes_heart,notes_base,gallery_urls,description';
const template = await readFile('src/index.template.html', 'utf8');
const enrichment = JSON.parse(await readFile('data/product-enrichment.json', 'utf8'));
const config = await readFile('supabase-config.js', 'utf8');
const url = config.match(/url:\s*['"]([^'"]+)['"]/)?.[1];
const key = process.env.SUPABASE_PUBLISHABLE_KEY || config.match(/publishableKey:\s*['"]([^'"]+)['"]/)?.[1];
if (!url || !key) throw new Error('No se encontró la configuración pública de Supabase.');

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);
const endpoint = url.replace(/\/$/, '') + '/rest/v1/products?select=' + encodeURIComponent(FIELDS) + '&active=eq.true&order=sort_order.asc,id.asc&limit=1000';
const response = await fetch(endpoint, { headers: { apikey: key }, signal: controller.signal });
clearTimeout(timer);
if (!response.ok) throw new Error('Supabase respondió HTTP ' + response.status);
const databaseProducts = await response.json();
const products = databaseProducts.map(product => {
  const extra = enrichment[String(product.id)];
  return extra ? { ...product, notes_top: extra.notes_top, notes_heart: extra.notes_heart, notes_base: extra.notes_base } : product;
});
if (!Array.isArray(products) || products.length === 0) throw new Error('El catálogo llegó vacío; se conserva el despliegue anterior.');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nums = value => (String(value).match(/[0-9][0-9,.]*/g) || []).map(v => Number(v.replace(/[,.]/g, ''))).filter(Number.isFinite);
const gender = { hombre: 'Hombre', mujer: 'Mujer', unisex: 'Unisex' };
const status = { disponible: 'Disponible', agotado: 'Agotado', encargo: 'Solo por encargo' };
const schemaAvailability = { disponible: 'https://schema.org/InStock', agotado: 'https://schema.org/OutOfStock', encargo: 'https://schema.org/PreOrder' };
const productUrl = p => SITE_URL + '/#producto-' + p.id;
// Solo devuelve una URL de imagen individual real. A propósito NO cae a la
// lámina completa de /pages/: esa lámina muestra hasta 12 productos distintos
// y jamás debe declararse como la foto de un producto en datos estructurados
// (ver hallazgo de la auditoría sobre JSON-LD e imágenes de producto).
const imageUrl = p => (p.image_url && /^https:\/\//i.test(p.image_url)) ? p.image_url : null;
const description = p => p.description || (p.name + ', perfume de ' + (p.brand || 'marca seleccionada') + ' en presentación ' + (p.size || 'por confirmar') + '. Consulta disponibilidad en Elite Scents RD.');
const usdPrice = p => {
  const value = nums(p.price)[0];
  return value ? 'US$' + Math.round(value / USD_RATE_DOP) + ' aprox.' : '';
};
const whatsapp = p => 'https://wa.me/18094333348?text=' + encodeURIComponent('Hola Elite Scents RD, me interesa: ' + p.name + ' (' + (p.size || 'tamaño por confirmar') + ', ' + (p.price || 'precio por confirmar') + '). ¿Puedes ayudarme?');

function visual(p) {
  if (p.image_url && /^https:\/\//i.test(p.image_url)) return '<div class="photo custom" role="img" aria-label="' + esc('Frasco de ' + p.name + (p.brand ? ' de ' + p.brand : '')) + '" style="background-image:url(&quot;' + esc(p.image_url) + '&quot;);background-size:contain;background-position:center"></div>';
  const page = Number(p.page), slot = Number(p.slot);
  const style = Number.isInteger(page) && page >= 1 && page <= 36 && Number.isInteger(slot) && slot >= 0 && slot < 12
    ? ' style="background-image:url(&quot;/pages/page-' + String(page).padStart(2,'0') + '.webp&quot;);background-position:' + (slot % 3 * 50) + '% ' + (Math.floor(slot / 3) * 30.13).toFixed(2) + '%"'
    : '';
  return '<div class="photo" role="img" aria-label="' + esc('Frasco de ' + p.name + (p.brand ? ' de ' + p.brand : '')) + '"' + style + '></div>';
}
function card(p) {
  const availability = status[p.availability] ? p.availability : 'disponible';
  const notes = [...(p.notes_top || []), ...(p.notes_heart || []), ...(p.notes_base || [])].slice(0,3).join(' · ') || (gender[p.gender] || 'Unisex');
  return '<article class="perfume" id="producto-' + esc(p.id) + '" data-product-id="' + esc(p.id) + '">' +
    visual(p) + '<span class="stock stock-' + availability + '">' + status[availability] + '</span>' +
    '<div class="meta"><span>' + esc(p.brand || gender[p.gender] || 'Perfume') + '</span><span>' + esc(p.size || '') + '</span></div>' +
    '<h3>' + esc(p.name) + '</h3><div class="size">' + esc(notes) + '</div><div class="price"><strong>' + esc(p.price || 'Precio a confirmar') + '</strong><small>' + esc(usdPrice(p)) + '</small></div>' +
    '<div class="card-actions"><button type="button" data-open-product="' + esc(p.id) + '">Ver detalles</button><a href="' + esc(whatsapp(p)) + '" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a></div></article>';
}
function schema(p) {
  const value = nums(p.price)[0];
  // Solo URLs HTTPS reales (foto individual + galería); nunca la lámina
  // completa. Si el producto todavía no tiene foto propia, se omite el campo
  // "image" en vez de inventar una imagen que no le pertenece.
  const images = [imageUrl(p), ...(p.gallery_urls || [])].filter(url => url && /^https:\/\//i.test(url)).slice(0, 3);
  const data = {
    '@context':'https://schema.org','@type':'Product',
    name:p.name,
    description:description(p),
    brand:{'@type':'Brand',name:p.brand || 'Elite Scents RD'},
    offers:{'@type':'Offer',price:value ? String(value) : undefined,priceCurrency:'DOP',availability:schemaAvailability[p.availability] || schemaAvailability.disponible,url:productUrl(p)}
  };
  if (images.length) data.image = images;
  return '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '<\/script>';
}

const catalog = '<!-- PRODUCT_CATALOG_START -->\n<div id="productGrid" class="grid" aria-busy="false">\n' + products.map(card).join('\n') + '\n</div>\n' +
  '<script type="application/json" id="preRenderedProducts">' + JSON.stringify(products).replace(/</g, '\\u003c') + '<\/script>\n<!-- PRODUCT_CATALOG_END -->';
const schemas = '<!-- PRODUCT_JSON_LD_START -->\n' + products.map(schema).join('\n') + '\n<!-- PRODUCT_JSON_LD_END -->';
const output = template
  .replace(/<!-- PRODUCT_CATALOG_START -->[\s\S]*?<!-- PRODUCT_CATALOG_END -->/, catalog)
  .replace(/<!-- PRODUCT_JSON_LD_START -->[\s\S]*?<!-- PRODUCT_JSON_LD_END -->/, schemas);
await writeFile('index.html', output);

// Regenera sitemap.xml en cada build: la portada cambia con el catálogo, así
// que su lastmod es siempre la fecha del build. Las páginas estáticas
// conservan la fecha de su último cambio real de contenido; actualízala a
// mano en STATIC_PAGES cuando edites privacidad.html o pedidos-envios.html.
const today = new Date().toISOString().slice(0, 10);
const STATIC_PAGES = [
  { path: 'pedidos-envios.html', lastmod: '2026-09-20', changefreq: 'monthly', priority: '0.6' },
  { path: 'privacidad.html', lastmod: '2026-09-20', changefreq: 'yearly', priority: '0.3' },
];
const sitemapUrl = (loc, lastmod, changefreq, priority) =>
  '  <url><loc>' + SITE_URL + loc + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>' + changefreq + '</changefreq><priority>' + priority + '</priority></url>';
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapUrl('/', today, 'weekly', '1.0') + '\n' +
  STATIC_PAGES.map(p => sitemapUrl('/' + p.path, p.lastmod, p.changefreq, p.priority)).join('\n') + '\n' +
  '</urlset>\n';
await writeFile('sitemap.xml', sitemap);

console.log('Catálogo pre-renderizado: ' + products.length + ' productos con JSON-LD.');
console.log('sitemap.xml actualizado (lastmod de portada: ' + today + ').');
