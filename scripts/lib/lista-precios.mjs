// Lista de precios imprimible (/lista-de-precios.html): se genera con cada publicación desde el mismo catálogo que la
// tienda, así que siempre está al día. En la página hay un botón para guardarla como PDF o imprimirla.
import { SITE_URL, BRAND, WHATSAPP, INSTAGRAM, esc, productPath } from './seo.mjs';

const GENDERS = [['hombre', 'Para él'], ['mujer', 'Para ella'], ['unisex', 'Unisex']];
const STATUS = { disponible: 'Disponible', encargo: 'Por encargo', agotado: 'Agotado' };
const thumbOf = url => /^\/img\/productos\/[^/]+\.(jpe?g|png)$/i.test(String(url || '')) ? url.replace('/img/productos/', '/img/productos/thumbs/').replace(/\.(jpe?g|png)$/i, '.webp') : '';
const phone = WHATSAPP.replace(/^1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

function item(p) {
  const status = STATUS[p.availability] ? p.availability : 'disponible', thumb = thumbOf(p.image_url);
  return '<li class="item" data-status="' + status + '">' +
    (thumb ? '<img class="photo" src="' + esc(thumb) + '" alt="" width="64" height="64">' : '<span class="photo"></span>') +
    '<div class="info"><a class="name" href="' + esc(productPath(p)) + '">' + esc(p.name) + '</a>' +
    '<span class="details">' + esc([p.brand, p.size].filter(Boolean).join(' · ')) + '</span>' +
    (p.inspired_by ? '<span class="inspired">Inspirado en ' + esc(p.inspired_by) + '</span>' : '') + '</div>' +
    '<div class="price">' + (p.original_price ? '<s>' + esc(p.original_price) + '</s>' : '') + '<strong>' + esc(p.price || 'Consultar') + '</strong>' +
    '<span class="status status-' + status + '">' + (p.original_price ? 'Oferta · ' : '') + STATUS[status] + '</span></div></li>';
}

export function renderPriceList(products, now = new Date()) {
  const date = now.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo' });
  const sections = GENDERS.map(([gender, title]) => {
    const list = products.filter(p => (p.gender || 'unisex') === gender)
      .sort((a, b) => String(a.brand || '').localeCompare(String(b.brand || ''), 'es', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return list.length ? '<section class="group" data-gender="' + gender + '"><h2>' + title + ' <small>(' + list.length + ')</small></h2><ul class="items">' + list.map(item).join('') + '</ul></section>' : '';
  }).join('');
  return '<!doctype html><html lang="es-DO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data: https:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'; upgrade-insecure-requests">' +
    '<title>Lista de precios | ' + BRAND + '</title><meta name="description" content="Lista de precios de ' + BRAND + ' al ' + esc(date) + ': ' + products.length + ' perfumes con precio en pesos dominicanos. Guárdala en PDF o imprímela.">' +
    '<meta name="robots" content="noindex,follow"><link rel="canonical" href="' + SITE_URL + '/lista-de-precios.html"><link rel="icon" href="/logo-oficial.webp" type="image/webp">' +
    '<link rel="stylesheet" href="/lista-precios.css"></head><body>' +
    '<header class="sheet-head"><img src="/logo-oficial.webp" width="64" height="64" alt="Logotipo de ' + BRAND + '"><div><h1>Lista de precios</h1>' +
    '<p>' + BRAND + ' · Actualizada el ' + esc(date) + ' · ' + products.length + ' perfumes</p>' +
    '<p>WhatsApp ' + phone + ' · Instagram @' + esc(INSTAGRAM.replace(/^https:\/\/www\.instagram\.com\//, '').replace(/\/$/, '')) + ' · ' + SITE_URL.replace('https://', '') + '</p></div></header>' +
    '<div class="controls" role="group" aria-label="Opciones de la lista"><button type="button" id="printList">Guardar como PDF / Imprimir</button>' +
    '<label><input type="checkbox" id="onlyAvailable"> Solo disponibles</label><label><input type="checkbox" id="showPhotos" checked> Con fotos</label>' +
    '<label>Mostrar <select id="genderFilter"><option value="all">Todos</option><option value="hombre">Para él</option><option value="mujer">Para ella</option><option value="unisex">Unisex</option></select></label>' +
    '<a href="/">← Volver a la tienda</a></div>' +
    '<main>' + sections + '</main>' +
    '<footer class="sheet-foot"><p>Precios en pesos dominicanos (RD$), sujetos a disponibilidad: confirma por WhatsApp antes de pagar. «Por encargo»: lo buscamos para ti después de confirmar. ' +
    '«Inspirado en»: el perfume famoso al que se parece el aroma, como referencia de estilo; no es el perfume original y las marcas mencionadas pertenecen a sus dueños.</p></footer>' +
    '<script defer src="/frame-guard.js"></script><script defer src="/lista-precios.js"></script></body></html>';
}
