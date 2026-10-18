// Prueba de render: ejecuta build-catalog.mjs sobre una copia temporal donde 12 productos tienen foto en Supabase,
// uno una URL de lámina (que debe ignorarse) y dos una foto guardada en el sitio (img/productos/).
// Comprueba tarjetas, placeholders y JSON-LD. No toca el index.html real.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { productSchema, SITE_URL } from './lib/seo.mjs';
const REPO = process.cwd();
const TMP = (await import('node:os')).tmpdir() + '/elite-render-test';
await mkdir(TMP + '/scripts', { recursive: true }); await mkdir(TMP + '/src', { recursive: true }); await mkdir(TMP + '/data', { recursive: true });
await cp(REPO + '/src', TMP + '/src', { recursive: true }); await cp(REPO + '/data', TMP + '/data', { recursive: true });
await cp(REPO + '/supabase-config.js', TMP + '/supabase-config.js'); await cp(REPO + '/cookies.js', TMP + '/cookies.js'); // cookies.js: números de la medición
await cp(REPO + '/scripts/lib', TMP + '/scripts/lib', { recursive: true });
const cfg = await readFile(REPO + '/supabase-config.js', 'utf8');
const base = cfg.match(/url:\s*'([^']+)'/)[1], key = cfg.match(/publishableKey:\s*'([^']+)'/)[1];
const fields = 'id,name,price,size,gender,page,slot,image_url,sort_order,availability,brand,notes_top,notes_heart,notes_base,gallery_urls,description';
const real = await (await fetch(base + '/rest/v1/products?select=' + fields + '&active=eq.true&order=sort_order.asc,id.asc&limit=1000', { headers: { apikey: key } })).json();
// Se eligen por posición (no por ID) porque algunos perfumes pueden estar ocultos (active = false). Las fotos del sitio
// deben caer entre las primeras 24 tarjetas (las que cargan la miniatura al abrir) y después de las 13 de Supabase/lámina.
const offerId = Number(real[16].id), [localA, localB] = [real[18], real[19]].map(p => Number(p.id));
const localFile = (id, suffix) => String(id).padStart(4, '0') + '-foto-local-' + suffix + '.jpg';
const withPhoto = real.map((p, i) => i < 12 ? { ...p, image_url: base + '/storage/v1/object/public/product-images/products/' + p.id + '/foto.jpg' } : i === 12 ? { ...p, image_url: SITE_URL + '/pages/page-02.webp' } : Number(p.id) === offerId ? { ...p, original_price: 'RD$4,500', price: 'RD$4,000', offer_label: 'Evento de prueba', offer_ends_at: '2030-01-01T04:00:00Z' } : [localA, localB].includes(Number(p.id)) ? { ...p, image_url: null } : p);
let src = await readFile(REPO + '/scripts/build-catalog.mjs', 'utf8');
const start = src.indexOf('const controller = new AbortController();'), end = src.indexOf('if (!Array.isArray(databaseProducts)');
src = src.slice(0, start) + 'const databaseProducts = JSON.parse(await readFile("data/fixture.json", "utf8"));\n' + src.slice(end);
// Cantidad en casa (script del 3-oct): un perfume disponible con 2 en casa y el resto con stock_left null.
const lowIndex = withPhoto.findIndex((p, i) => i >= 13 && i < 24 && p.availability === 'disponible' && Number(p.id) !== offerId && ![localA, localB].includes(Number(p.id)));
const lowId = lowIndex >= 0 ? Number(withPhoto[lowIndex].id) : null;
withPhoto.forEach((p, i) => { p.stock_left = i === lowIndex ? 2 : null; });
await writeFile(TMP + '/data/fixture.json', JSON.stringify(withPhoto));
await writeFile(TMP + '/scripts/build-catalog.mjs', src);
// Dos productos más con foto guardada en el sitio (img/productos/), sin image_url en la base.
await rm(TMP + '/img', { recursive: true, force: true }); await mkdir(TMP + '/img/productos', { recursive: true });
await writeFile(TMP + '/img/productos/' + localFile(localA, 'a'), 'x'); await writeFile(TMP + '/img/productos/' + localFile(localB, 'b'), 'x');
execFileSync('node', ['scripts/build-catalog.mjs'], { cwd: TMP, stdio: 'inherit' });
const fullHtml = await readFile(TMP + '/index.html', 'utf8');
// Las primeras 24 tarjetas del catálogo (las secciones destacadas dependen de las ventas reales y se revisan aparte).
const html = fullHtml.slice(fullHtml.indexOf('<div id="productGrid"'), fullHtml.indexOf('<script type="application/json" id="catalogInfo">'));
const publicProducts = JSON.parse(await readFile(TMP + '/perfumes.json', 'utf8'));
// Ficha Product de cada perfume: la misma que lleva su página (/perfumes/…).
const schemas = publicProducts.map(productSchema);
const conFoto = schemas.filter(s => s.image);
console.log('tarjetas con foto:', (html.match(/class="photo custom"/g) || []).length, '| placeholders:', (html.match(/class="photo placeholder"/g) || []).length, '| fichas con image:', conFoto.length, '| fichas:', schemas.length);
assert.equal((html.match(/class="photo custom"/g) || []).length, 14);
assert.equal((html.match(/class="photo placeholder"/g) || []).length, Math.min(24, real.length) - 14);
assert.equal(conFoto.length, 14);
assert.equal(schemas.length, real.length);
for (const [id, file] of [[localA, localFile(localA, 'a')], [localB, localFile(localB, 'b')]]) {
  const p = withPhoto.find(x => Number(x.id) === id);
  assert(schemas.find(s => s.name === p.name).image.includes(SITE_URL + '/img/productos/' + file), 'JSON-LD debe usar la URL absoluta de la foto local de ' + p.name);
  assert(html.includes('<img src="/img/productos/thumbs/' + file.replace('.jpg', '.webp') + '"'), 'La tarjeta debe usar la miniatura del sitio de ' + p.name);
}
for (const p of withPhoto.slice(0, 12)) assert(schemas.find(s => s.name === p.name).image.includes(p.image_url), 'JSON-LD debe usar la foto individual de ' + p.name);
assert(!fullHtml.includes('/pages/page-') && !JSON.stringify(publicProducts).includes('/pages/page-'), 'no debe haber láminas en el HTML ni en el catálogo');
assert(!/"page":|"slot":/.test(fullHtml + JSON.stringify(publicProducts)), 'page/slot no deben salir en el HTML ni en el catálogo');
// Oferta: precio anterior tachado, precio de oferta, etiqueta del evento y validez en JSON-LD (el resto no muestra oferta).
{
  const offerCard = html.match(new RegExp('<article class="perfume" id="producto-' + offerId + '"[\\s\\S]*?<\\/article>'))[0];
  assert(offerCard.includes('<small class="price-was">Antes <s>RD$4,500</s></small>') && offerCard.includes('<strong>Ahora RD$4,000</strong>'), 'La tarjeta debe mostrar Antes (tachado) y Ahora');
  assert(offerCard.includes('OFERTA · Evento de prueba'), 'La tarjeta debe mostrar la etiqueta del evento');
  assert.equal((html.match(/class="offer-badge"/g) || []).length, 1, 'Solo el producto en oferta debe tener etiqueta');
  const offerSchema = schemas.find(s => s.name === withPhoto.find(x => Number(x.id) === offerId).name);
  assert.equal(offerSchema.offers.price, '4000'); assert.equal(offerSchema.offers.priceValidUntil, '2030-01-01');
  const pOffer = publicProducts.find(p => Number(p.id) === offerId); assert.equal(pOffer.original_price, 'RD$4,500'); assert.equal(pOffer.price, 'RD$4,000');
  assert(publicProducts.every(p => !('created_at' in p) && !('updated_at' in p) && !('active' in p) && !('page' in p)), 'El JSON público solo debe llevar los campos previstos');
  assert(lowId !== null, 'Hay un perfume disponible entre las primeras tarjetas para probar «¡Quedan…!»');
  {
    assert(html.includes('<span class="stock stock-disponible stock-low">¡Quedan 2!</span>'), 'La tarjeta dice «¡Quedan 2!»');
    assert.equal((html.match(/stock-low/g) || []).length, 1, 'Solo en ese perfume');
    assert.deepEqual(publicProducts.filter(p => 'stock_left' in p).map(p => [Number(p.id), p.stock_left]), [[lowId, 2]], 'perfumes.json lleva stock_left solo cuando hay pocas unidades');
    assert(/"stock":true/.test(fullHtml.match(/<script type="application\/json" id="catalogInfo">([^<]*)</)[1]), 'La portada avisa a la tienda que pida stock_left');
  }
}
console.log('Fichas y tarjetas correctas: 12 fotos de Supabase + 2 del sitio, la URL de lámina se ignoró, ' + (real.length - 14) + ' sin foto.');
