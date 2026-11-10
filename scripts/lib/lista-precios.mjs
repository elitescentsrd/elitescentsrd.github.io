// Listas de precios imprimibles: se generan con cada publicación desde el mismo catálogo que la tienda, así que siempre
// están al día, y tienen un botón para guardarlas como PDF o imprimirlas.
//   /lista-de-precios.html  la del público: precio de contado (pagas al recibir).
//   /lista-clientes.html    la de clientes que la tienda conoce: precio de contado y a dos pagos. No se enlaza en la
//                           tienda ni la ve Google (noindex, nofollow, fuera del mapa del sitio): la tienda la manda por
//                           WhatsApp a quien quiere.
import { SITE_URL, BRAND, WHATSAPP, INSTAGRAM, esc, productPath, dosPagosText } from './seo.mjs';

const GENDERS = [['hombre', 'Para él'], ['mujer', 'Para ella'], ['unisex', 'Unisex']];
const STATUS = { disponible: 'Disponible', encargo: 'Por encargo', agotado: 'Agotado' };
const thumbOf = url => /^\/img\/productos\/[^/]+\.(jpe?g|png)$/i.test(String(url || '')) ? url.replace('/img/productos/', '/img/productos/thumbs/').replace(/\.(jpe?g|png)$/i, '.webp') : '';
const phone = WHATSAPP.replace(/^1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

function item(p, clientes) {
  const status = STATUS[p.availability] ? p.availability : 'disponible', thumb = thumbOf(p.image_url);
  return '<li class="item" data-status="' + status + '">' +
    (thumb ? '<img class="photo" src="' + esc(thumb) + '" alt="" width="64" height="64">' : '<span class="photo"></span>') +
    '<div class="info"><a class="name" href="' + esc(productPath(p)) + '">' + esc(p.name) + '</a>' +
    '<span class="details">' + esc([p.brand, p.size].filter(Boolean).join(' · ')) + '</span>' +
    (p.inspired_by ? '<span class="inspired">Inspirado en ' + esc(p.inspired_by) + '</span>' : '') + '</div>' +
    '<div class="price">' + (p.original_price ? '<s>' + esc(p.original_price) + '</s>' : '') + '<strong>' + esc(p.price || 'Consultar') + '</strong>' +
    (clientes && dosPagosText(p) ? '<span class="plan">Contado</span><span class="dos-pagos">' + esc(dosPagosText(p)) + '</span>' : '') +
    '<span class="status status-' + status + '">' + (p.original_price ? 'Oferta · ' : '') + STATUS[status] + '</span></div></li>';
}

export function renderPriceList(products, now = new Date(), { clientes = false } = {}) {
  const page = clientes ? '/lista-clientes.html' : '/lista-de-precios.html', title = clientes ? 'Lista de precios para clientes' : 'Lista de precios';
  const date = now.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo' });
  const sections = GENDERS.map(([gender, title]) => {
    const list = products.filter(p => (p.gender || 'unisex') === gender)
      .sort((a, b) => String(a.brand || '').localeCompare(String(b.brand || ''), 'es', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return list.length ? '<section class="group" data-gender="' + gender + '"><h2>' + title + ' <small>(' + list.length + ')</small></h2><ul class="items">' + list.map(p => item(p, clientes)).join('') + '</ul></section>' : '';
  }).join('');
  return '<!doctype html><html lang="es-DO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data: https:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'; upgrade-insecure-requests">' +
    '<title>' + title + ' | ' + BRAND + '</title><meta name="description" content="' + title + ' de ' + BRAND + ' al ' + esc(date) + ': ' + products.length + ' perfumes con precio en pesos dominicanos. Guárdala en PDF o imprímela.">' +
    '<meta name="robots" content="' + (clientes ? 'noindex,nofollow' : 'noindex,follow') + '"><link rel="canonical" href="' + SITE_URL + page + '"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/img/app/icon-192.png" sizes="192x192" type="image/png">' +
    '<link rel="stylesheet" href="/lista-precios.css"></head><body>' +
    '<header class="sheet-head"><img src="/logo-oficial.webp" width="64" height="64" alt="Logotipo de ' + BRAND + '"><div><h1>' + title + '</h1>' +
    '<p class="sheet-plan">' + (clientes ? 'Precio de contado (pagas al recibir) o a dos pagos: la mitad al recibir y la otra mitad en 15 días.' : 'Precios de contado: pagas todo al recibir.') + '</p>' +
    '<p>' + BRAND + ' · Actualizada el ' + esc(date) + ' · ' + products.length + ' perfumes</p>' +
    '<p>WhatsApp ' + phone + ' · Instagram @' + esc(INSTAGRAM.replace(/^https:\/\/www\.instagram\.com\//, '').replace(/\/$/, '')) + ' · ' + SITE_URL.replace('https://', '') + '</p></div></header>' +
    '<div class="controls" role="group" aria-label="Opciones de la lista"><button type="button" id="printList">Guardar como PDF / Imprimir</button>' +
    '<label><input type="checkbox" id="onlyAvailable"> Solo disponibles</label><label><input type="checkbox" id="showPhotos" checked> Con fotos</label>' +
    '<label>Mostrar <select id="genderFilter"><option value="all">Todos</option><option value="hombre">Para él</option><option value="mujer">Para ella</option><option value="unisex">Unisex</option></select></label>' +
    '<a href="/">← Volver a la tienda</a></div>' +
    '<main>' + sections + '</main>' +
    '<footer class="sheet-foot"><p>Precios en pesos dominicanos (RD$), sujetos a disponibilidad: confirma por WhatsApp antes de pagar. ' +
    (clientes ? 'Los dos pagos son solo para clientes de la tienda y se coordinan por WhatsApp. ' : '') + '«Por encargo»: lo buscamos para ti después de confirmar. ' +
    '«Inspirado en»: el perfume famoso al que se parece el aroma, como referencia de estilo; no es el perfume original y las marcas mencionadas pertenecen a sus dueños.</p></footer>' +
    '<script defer src="/frame-guard.js"></script><script defer src="/lista-precios.js"></script></body></html>';
}
