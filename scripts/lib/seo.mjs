// SEO compartido por el build del catálogo (sitemap, enlaces) y la generación del sitio (una página por perfume).
export const SITE_URL = 'https://elitescentsrd.github.io';
export const BRAND = 'Elite Scents RD';
export const WHATSAPP = '18094333348';
export const INSTAGRAM = 'https://www.instagram.com/elite.scentsrd/';

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
  const title = p.name + (p.brand ? ' – ' + p.brand : '') + ' | ' + BRAND;
  const metaDescription = (p.name + (p.brand ? ' de ' + p.brand : '') + ' en ' + BRAND + (who ? ': perfume ' + who : '') + (p.size ? ', ' + p.size : '') + '. ' +
    (onOffer ? 'Oferta ' + price + ' (antes ' + p.original_price + '). ' : price + '. ') + 'Pídelo por WhatsApp en República Dominicana.').slice(0, 300);
  const whatsapp = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent('Hola Elite Scents RD, me interesa: ' + p.name + ' (' + (p.size || 'tamaño por confirmar') + ', ' + price + '). ¿Puedes ayudarme?');
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL + '/' },
    { '@type': 'ListItem', position: 2, name: 'Perfumes', item: SITE_URL + '/#coleccion' },
    { '@type': 'ListItem', position: 3, name: p.name, item: url },
  ] };
  const notes = [['Salida', p.notes_top], ['Corazón', p.notes_heart], ['Fondo', p.notes_base]].filter(([, list]) => (list || []).length)
    .map(([label, list]) => '<div><dt>' + label + '</dt><dd>' + esc(listNotes(list)) + '</dd></div>').join('');
  const photo = image
    ? '<img src="' + esc(p.image_url) + '" alt="' + esc('Frasco de ' + p.name + (p.brand ? ' de ' + p.brand : '')) + '" width="900" height="900" fetchpriority="high">'
    : '<div class="photo placeholder" role="img" aria-label="' + esc('Foto próximamente de ' + p.name) + '"></div>';
  const relatedHtml = related.length
    ? '<section class="related"><h2 class="doc-h2">Más perfumes de ' + esc(p.brand) + '</h2><ul class="related-list">' + related.map(r => '<li><a href="' + esc(productPath(r)) + '">' + esc(r.name) + '</a> <span>' + esc(r.price || '') + '</span></li>').join('') + '</ul></section>'
    : '';
  return '<!doctype html><html lang="es-DO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data: https:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'; upgrade-insecure-requests">' +
    '<title>' + esc(title) + '</title><meta name="description" content="' + esc(metaDescription) + '"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="' + esc(url) + '">' +
    '<meta property="og:type" content="product"><meta property="og:site_name" content="' + BRAND + '"><meta property="og:locale" content="es_DO"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(metaDescription) + '"><meta property="og:url" content="' + esc(url) + '">' +
    '<meta property="og:image" content="' + esc(image || SITE_URL + '/social-card.png') + '"><meta name="twitter:card" content="summary_large_image">' +
    '<meta name="theme-color" content="#14130f"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/img/app/apple-touch-icon.png">' +
    '<link rel="stylesheet" href="/tienda.css"><link rel="icon" href="/logo-oficial.webp" type="image/webp">' + jsonLd(productSchema(p)) + jsonLd(breadcrumb) + '</head><body>' +
    '<header class="header"><a class="brand" href="/"><img src="/logo-oficial.webp" width="48" height="48" alt="Logotipo de Elite Scents RD"><span>ELITE <em>SCENTS</em><small>REPÚBLICA DOMINICANA</small></span></a><a href="/#coleccion">← Ver todos los perfumes</a></header>' +
    '<main class="collection product-page"><nav class="breadcrumb" aria-label="Ruta"><a href="/">Inicio</a> › <a href="/#coleccion">Perfumes</a> › <span>' + esc(p.name) + '</span></nav>' +
    '<article class="product-detail"><div class="product-detail-photo">' + photo + '</div><div class="product-detail-info">' +
    '<p class="eyebrow">' + esc(p.brand || BRAND) + '</p><h1 class="detail-title">' + esc(p.name) + '</h1>' +
    (onOffer ? '<span class="offer-badge detail-offer">OFERTA' + (p.offer_label ? ' · ' + esc(p.offer_label) : '') + '</span>' : '') +
    '<p class="detail-price' + (onOffer ? ' price-offer' : '') + '">' + (onOffer ? '<small class="price-was">Antes <s>' + esc(p.original_price) + '</s></small> ' : '') + '<strong>' + (onOffer ? 'Ahora ' : '') + esc(price) + '</strong></p>' +
    '<dl class="product-facts"><div><dt>Tamaño</dt><dd>' + esc(p.size || 'Por confirmar') + '</dd></div><div><dt>Para</dt><dd>' + esc(genderLabel[p.gender] || 'Unisex') + '</dd></div><div><dt>Disponibilidad</dt><dd>' + statusLabel[availability] + '</dd></div>' + notes + '</dl>' +
    '<p class="dialog-description">' + esc(p.description || '') + '</p>' +
    '<div class="dialog-order-actions"><a class="button gold" href="' + esc(whatsapp) + '" target="_blank" rel="noopener noreferrer">Pedir por WhatsApp ↗</a><a class="button outline" href="/#producto-' + esc(p.id) + '">Ver en la tienda y agregar al carrito</a></div>' +
    '</div></article>' + relatedHtml + '</main>' +
    '<footer class="footer"><div><a href="/">Inicio</a><a href="/pedidos-envios.html">Pedidos y envíos</a><a href="/canales-oficiales.html">Canales oficiales</a><a href="/privacidad.html">Privacidad</a></div><p class="copyright">© Elite Scents RD</p></footer><script defer src="/frame-guard.js"></script><script src="/cookies.js"></script><script defer src="/pwa.js"></script></body></html>';
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
