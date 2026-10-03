// SEO compartido por el build del catálogo (sitemap, enlaces) y la generación del sitio (una página por perfume).
import { readFileSync } from 'node:fs';
export const SITE_URL = 'https://elitescentsrd.github.io';
export const BRAND = 'Elite Scents RD';
export const WHATSAPP = '18094333348';
export const INSTAGRAM = 'https://www.instagram.com/elite.scentsrd/';
// Dirección de Supabase (pública, la misma de supabase-config.js): las páginas solo pueden conectarse ahí (estadísticas).
const SUPABASE_ORIGIN = (readFileSync('supabase-config.js', 'utf8').match(/url:\s*['"](https:\/\/[a-z0-9-]+\.supabase\.co)['"]/) || [])[1];
if (!SUPABASE_ORIGIN) throw new Error('supabase-config.js no trae la dirección de Supabase.');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self' " + SUPABASE_ORIGIN + "; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests";
const STATS_SCRIPTS = '<script defer src="/supabase-config.js"></script><script defer src="/analytics.js"></script>';
// Botón flotante de WhatsApp (el mismo de todas las páginas públicas).
const WA_FLOAT = '<a class="wa-float" href="https://wa.me/18094333348?text=Hola%20Elite%20Scents%20RD%2C%20quiero%20informaci%C3%B3n%20de%20un%20perfume" target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp" title="Escríbenos por WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg></a>';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Debe ser idéntica a slugify() de tienda.js (una prueba lo comprueba con los 420 nombres).
export const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/, '');
export const productPath = p => '/perfumes/' + slugify(p.name) + '-' + p.id + '.html';
export const productUrl = p => SITE_URL + productPath(p);
export const absoluteUrl = url => (typeof url === 'string' && url.startsWith('/')) ? SITE_URL + url : (url || '');

const nums = value => (String(value).match(/[0-9][0-9,.]*/g) || []).map(v => Number(v.replace(/[,.]/g, ''))).filter(Number.isFinite);
const genderText = { hombre: 'para hombre', mujer: 'para mujer', unisex: 'unisex' };
const genderLabel = { hombre: 'Hombre', mujer: 'Mujer', unisex: 'Unisex' };
const statusLabel = { disponible: 'Disponible', agotado: 'Agotado', encargo: 'Solo por encargo' };
// «¡Quedan 2!» (solo si el dueño lleva la cantidad en casa y quedan de 1 a 3).
export const stockText = p => { const n = Number(p.stock_left); return p.availability === 'disponible' && Number.isInteger(n) && n >= 1 && n <= 3 ? (n === 1 ? '¡Queda 1!' : '¡Quedan ' + n + '!') : ''; };
const schemaAvailability = { disponible: 'https://schema.org/InStock', agotado: 'https://schema.org/OutOfStock', encargo: 'https://schema.org/PreOrder' };
const listNotes = items => (items || []).join(', ');

export function productSchema(p) {
  const price = nums(p.price)[0];
  const images = [p.image_url, ...(p.gallery_urls || [])].filter(Boolean).map(absoluteUrl).slice(0, 3);
  const data = {
    '@context': 'https://schema.org', '@type': 'Product', '@id': productUrl(p) + '#product',
    name: p.name, sku: String(p.id), description: p.description || undefined,
    brand: { '@type': 'Brand', name: p.brand || BRAND },
    offers: {
      '@type': 'Offer', url: productUrl(p), price: price ? String(price) : undefined, priceCurrency: 'DOP', itemCondition: 'https://schema.org/NewCondition',
      availability: schemaAvailability[p.availability] || schemaAvailability.disponible,
      priceValidUntil: p.original_price && p.offer_ends_at ? String(p.offer_ends_at).slice(0, 10) : undefined,
      seller: { '@type': 'Organization', name: BRAND, url: SITE_URL + '/' },
    },
  };
  if (images.length) data.image = images;
  return data;
}

const jsonLd = data => '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>';

export function renderProductPage(p, related = []) {
  const url = productUrl(p), image = absoluteUrl(p.image_url);
  const availability = statusLabel[p.availability] ? p.availability : 'disponible';
  const onOffer = Boolean(p.original_price), price = p.price || 'Precio a confirmar';
  const who = genderText[p.gender] || '';
  // La marca va en el título solo si el nombre no la trae ya («Lattafa Asad – Lattafa» repetía la marca).
  const plain = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const title = p.name + (p.brand && !plain(p.name).includes(plain(p.brand)) ? ' – ' + p.brand : '') + ' | ' + BRAND;
  const metaDescription = (p.name + (p.brand ? ' de ' + p.brand : '') + ' en ' + BRAND + (who ? ': perfume ' + who : '') + (p.size ? ', ' + p.size : '') + '. ' +
    (onOffer ? 'Oferta ' + price + ' (antes ' + p.original_price + '). ' : price + '. ') + 'Pídelo por WhatsApp en República Dominicana.');
  const metaShort = metaDescription.length <= 160 ? metaDescription : metaDescription.slice(0, 159).replace(/\s+\S*$/, '') + '…';
  const whatsapp = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent('Hola Elite Scents RD, me interesa: ' + p.name + ' (' + (p.size || 'tamaño por confirmar') + ', ' + price + '). ¿Puedes ayudarme?');
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL + '/' },
    { '@type': 'ListItem', position: 2, name: 'Perfumes', item: SITE_URL + '/perfumes/' },
    { '@type': 'ListItem', position: 3, name: p.name, item: url },
  ] };
  const notes = [['Salida', p.notes_top], ['Corazón', p.notes_heart], ['Fondo', p.notes_base]].filter(([, list]) => (list || []).length)
    .map(([label, list]) => '<div><dt>' + label + '</dt><dd>' + esc(listNotes(list)) + '</dd></div>').join('');
  const img = '<img src="' + esc(p.image_url) + '" alt="' + esc('Frasco de ' + p.name + (p.brand ? ' de ' + p.brand : '')) + '" width="900" height="900" fetchpriority="high">';
  const photo = image
    ? (p.image_webp ? '<picture><source srcset="' + esc(p.image_webp) + '" type="image/webp">' + img + '</picture>' : img)
    : '<div class="photo placeholder" role="img" aria-label="' + esc('Foto próximamente de ' + p.name) + '"></div>';
  const relatedHtml = related.length
    ? '<section class="related"><h2 class="doc-h2">Más perfumes de ' + esc(p.brand) + '</h2><ul class="related-list">' + related.map(r => '<li><a href="' + esc(productPath(r)) + '">' + esc(r.name) + '</a> <span>' + esc(r.price || '') + '</span></li>').join('') + '</ul></section>'
    : '';
  return '<!doctype html><html lang="es-DO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
    '<title>' + esc(title) + '</title><meta name="description" content="' + esc(metaShort) + '"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="' + esc(url) + '">' +
    '<meta property="og:type" content="product"><meta property="og:site_name" content="' + BRAND + '"><meta property="og:locale" content="es_DO"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(metaShort) + '"><meta property="og:url" content="' + esc(url) + '">' +
    '<meta property="og:image" content="' + esc(image || SITE_URL + '/social-card.png') + '"><meta name="twitter:card" content="summary_large_image">' +
    '<meta name="theme-color" content="#14130f"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/img/app/apple-touch-icon.png">' +
    '<link rel="stylesheet" href="/tienda.css"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/img/app/icon-192.png" sizes="192x192" type="image/png">' + jsonLd(productSchema(p)) + jsonLd(breadcrumb) + '</head><body data-product-id="' + esc(p.id) + '">' +
    '<header class="header"><a class="brand" href="/"><img src="/logo-oficial.webp" width="48" height="48" alt="Logotipo de Elite Scents RD"><span>ELITE <em>SCENTS</em><small>REPÚBLICA DOMINICANA</small></span></a><a href="/#coleccion">← Ver todos los perfumes</a></header>' +
    '<main class="collection product-page"><nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> › <a href="/perfumes/">Perfumes</a> › <span>' + esc(p.name) + '</span></nav>' +
    '<article class="product-detail"><div class="product-detail-photo">' + photo + '</div><div class="product-detail-info">' +
    '<p class="eyebrow">' + esc(p.brand || BRAND) + '</p><h1 class="detail-title">' + esc(p.name) + '</h1>' +
    (onOffer ? '<span class="offer-badge detail-offer">OFERTA' + (p.offer_label ? ' · ' + esc(p.offer_label) : '') + '</span>' : '') +
    '<p class="detail-price' + (onOffer ? ' price-offer' : '') + '">' + (onOffer ? '<small class="price-was">Antes <s>' + esc(p.original_price) + '</s></small> ' : '') + '<strong>' + (onOffer ? 'Ahora ' : '') + esc(price) + '</strong></p>' +
    '<dl class="product-facts"><div><dt>Tamaño</dt><dd>' + esc(p.size || 'Por confirmar') + '</dd></div><div><dt>Para</dt><dd>' + esc(genderLabel[p.gender] || 'Unisex') + '</dd></div><div><dt>Disponibilidad</dt><dd>' + statusLabel[availability] + (stockText(p) ? ' · <strong class="stock-low-text">' + stockText(p) + '</strong>' : '') + '</dd></div>' +
    (p.inspired_by ? '<div class="inspired-fact"><dt>Inspirado en</dt><dd>' + esc(p.inspired_by) + '</dd></div>' : '') + notes + '</dl>' +
    (p.inspired_by ? '<p class="inspired-note">Referencia de estilo del aroma: no es el perfume original. Las marcas mencionadas pertenecen a sus dueños.</p>' : '') +
    '<p class="dialog-description">' + esc(p.description || '') + '</p>' +
    '<div class="dialog-order-actions"><a class="button gold" href="' + esc(whatsapp) + '" target="_blank" rel="noopener noreferrer">Pedir por WhatsApp ↗</a><a class="button outline" href="/#producto-' + esc(p.id) + '">Ver en la tienda y agregar al carrito</a>' +
    (availability === 'agotado' || availability === 'encargo' ? '<a class="button outline" href="/#avisame-' + esc(p.id) + '">🔔 Avísame cuando llegue</a>' : '') + '</div>' +
    '</div></article>' + relatedHtml + '</main>' +
    '<footer class="footer"><div><a href="/">Inicio</a><a href="/pedidos-envios.html">Pedidos y envíos</a><a href="/canales-oficiales.html">Canales oficiales</a><a href="/privacidad.html">Privacidad</a><a href="/aviso-legal.html">Aviso legal</a></div><p class="copyright">© Elite Scents RD</p></footer>' + WA_FLOAT + '<script defer src="/frame-guard.js"></script><script src="/cookies.js"></script>' + STATS_SCRIPTS + '<script defer src="/pwa.js"></script></body></html>';
}

// Datos de la marca para el buscador: nombre, variantes de escritura, logotipo, redes y contacto.
export function brandSchema() {
  const names = ['EliteScentsRD', 'Elite Scents', 'Elite Scents República Dominicana'];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': SITE_URL + '/#website', url: SITE_URL + '/', name: BRAND, alternateName: names, inLanguage: 'es-DO', publisher: { '@id': SITE_URL + '/#organization' } },
      {
        '@type': 'Store', '@id': SITE_URL + '/#organization', name: BRAND, alternateName: names, url: SITE_URL + '/',
        description: 'Tienda de perfumes en República Dominicana: fragancias para hombre, mujer y unisex con precios en pesos dominicanos y pedidos por WhatsApp.',
        logo: { '@type': 'ImageObject', url: SITE_URL + '/logo-oficial.webp' }, image: SITE_URL + '/social-card.png',
        telephone: '+18094333348', sameAs: [INSTAGRAM],
        areaServed: { '@type': 'Country', name: 'República Dominicana' }, address: { '@type': 'PostalAddress', addressCountry: 'DO' },
        contactPoint: { '@type': 'ContactPoint', telephone: '+18094333348', contactType: 'customer service', areaServed: 'DO', availableLanguage: 'es' },
      },
    ],
  };
}
export const brandSchemaScript = () => jsonLd(brandSchema());

// /perfumes/: todos los perfumes de la A a la Z por marca, con precio y disponibilidad. Liviana e indexable: le da a
// Google (y a quien prefiere una lista) un camino a cada página de perfume sin cargar el catálogo completo en la portada.
export function renderDirectory(products) {
  const url = SITE_URL + '/perfumes/', total = products.length;
  const title = 'Todos los perfumes de la A a la Z | ' + BRAND;
  const description = 'Lista completa de los ' + total + ' perfumes de ' + BRAND + ' con precio en pesos dominicanos y disponibilidad. Para hombre, mujer y unisex; pídelos por WhatsApp.';
  const groups = new Map();
  for (const p of products) {
    const brand = String(p.brand || '').trim() || 'Otras marcas';
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(p);
  }
  const brands = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const anchor = brand => 'marca-' + slugify(brand);
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL + '/' },
    { '@type': 'ListItem', position: 2, name: 'Perfumes', item: url },
  ] };
  const item = p => {
    const availability = statusLabel[p.availability] ? p.availability : 'disponible';
    return '<li><a href="' + esc(productPath(p)) + '">' + esc(p.name) + '</a><span class="directory-size">' + esc(p.size || '') + '</span>' +
      '<span class="directory-price">' + (p.original_price ? '<s>' + esc(p.original_price) + '</s> ' : '') + esc(p.price || 'Precio a confirmar') + '</span>' +
      '<span class="directory-status status-' + availability + '">' + statusLabel[availability] + '</span></li>';
  };
  return '<!doctype html><html lang="es-DO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
    '<title>' + esc(title) + '</title><meta name="description" content="' + esc(description) + '"><meta name="robots" content="index,follow"><link rel="canonical" href="' + url + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="' + BRAND + '"><meta property="og:locale" content="es_DO"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(description) + '"><meta property="og:url" content="' + url + '"><meta property="og:image" content="' + SITE_URL + '/social-card.png">' +
    '<meta name="theme-color" content="#14130f"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/img/app/apple-touch-icon.png">' +
    '<link rel="stylesheet" href="/tienda.css"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/img/app/icon-192.png" sizes="192x192" type="image/png">' + jsonLd(breadcrumb) + '</head><body>' +
    '<header class="header"><a class="brand" href="/"><img src="/logo-oficial.webp" width="48" height="48" alt="Logotipo de Elite Scents RD"><span>ELITE <em>SCENTS</em><small>REPÚBLICA DOMINICANA</small></span></a><a href="/#coleccion">← Volver a la tienda</a></header>' +
    '<main class="collection directory"><nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> › <span>Perfumes</span></nav>' +
    '<h1 class="detail-title">Todos los perfumes</h1><p class="directory-intro">' + total + ' fragancias de ' + brands.length + ' marcas, ordenadas por marca. Toca un perfume para ver sus notas, su foto y pedirlo.</p>' +
    '<nav class="directory-brands" aria-label="Marcas">' + brands.map(b => '<a href="#' + anchor(b) + '">' + esc(b) + '</a>').join('') + '</nav>' +
    brands.map(b => '<section class="directory-group" id="' + anchor(b) + '"><h2 class="doc-h2">' + esc(b) + ' <small>(' + groups.get(b).length + ')</small></h2><ul class="directory-list">' +
      groups.get(b).sort((x, y) => x.name.localeCompare(y.name, 'es', { sensitivity: 'base' })).map(item).join('') + '</ul></section>').join('') +
    '</main><footer class="footer"><div><a href="/">Inicio</a><a href="/pedidos-envios.html">Pedidos y envíos</a><a href="/canales-oficiales.html">Canales oficiales</a><a href="/privacidad.html">Privacidad</a><a href="/aviso-legal.html">Aviso legal</a></div><p class="copyright">© Elite Scents RD</p></footer>' + WA_FLOAT + '' +
    '<script defer src="/frame-guard.js"></script><script src="/cookies.js"></script>' + STATS_SCRIPTS + '<script defer src="/pwa.js"></script></body></html>';
}
