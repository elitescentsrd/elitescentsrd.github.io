// Prueba de render: ejecuta build-catalog.mjs sobre una copia temporal donde 12 productos tienen foto en Supabase,
// uno una URL de lámina (que debe ignorarse) y dos una foto guardada en el sitio (img/productos/).
// Comprueba tarjetas, placeholders y JSON-LD. No toca el index.html real.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const REPO = process.cwd();
const TMP = (await import('node:os')).tmpdir() + '/elite-render-test';
await mkdir(TMP + '/scripts', { recursive: true }); await mkdir(TMP + '/src', { recursive: true }); await mkdir(TMP + '/data', { recursive: true });
await cp(REPO + '/src', TMP + '/src', { recursive: true }); await cp(REPO + '/data', TMP + '/data', { recursive: true });
await cp(REPO + '/supabase-config.js', TMP + '/supabase-config.js');
const cfg = await readFile(REPO + '/supabase-config.js', 'utf8');
const base = cfg.match(/url:\s*'([^']+)'/)[1], key = cfg.match(/publishableKey:\s*'([^']+)'/)[1];
const fields = 'id,name,price,size,gender,page,slot,image_url,sort_order,availability,brand,notes_top,notes_heart,notes_base,gallery_urls,description';
const real = await (await fetch(base + '/rest/v1/products?select=' + fields + '&active=eq.true&order=sort_order.asc,id.asc&limit=1000', { headers: { apikey: key } })).json();
const withPhoto = real.map((p, i) => i < 12 ? { ...p, image_url: base + '/storage/v1/object/public/product-images/products/' + p.id + '/foto.jpg' } : i === 12 ? { ...p, image_url: 'https://elitescentsrd.github.io/pages/page-02.webp' } : Number(p.id) === 30 ? { ...p, original_price: 'RD$4,500', price: 'RD$4,000', offer_label: 'Evento de prueba', offer_ends_at: '2030-01-01T04:00:00Z' } : p);
let src = await readFile(REPO + '/scripts/build-catalog.mjs', 'utf8');
const start = src.indexOf('const controller = new AbortController();'), end = src.indexOf('if (!Array.isArray(databaseProducts)');
src = src.slice(0, start) + 'const databaseProducts = JSON.parse(await readFile("data/fixture.json", "utf8"));\n' + src.slice(end);
await writeFile(TMP + '/data/fixture.json', JSON.stringify(withPhoto));
await writeFile(TMP + '/scripts/build-catalog.mjs', src);
// Dos productos más con foto guardada en el sitio (img/productos/), sin image_url en la base.
await rm(TMP + '/img', { recursive: true, force: true }); await mkdir(TMP + '/img/productos', { recursive: true });
await writeFile(TMP + '/img/productos/0020-foto-local-a.jpg', 'x'); await writeFile(TMP + '/img/productos/0021-foto-local-b.jpg', 'x');
execFileSync('node', ['scripts/build-catalog.mjs'], { cwd: TMP, stdio: 'inherit' });
const html = await readFile(TMP + '/index.html', 'utf8');
const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).filter(s => s['@type'] === 'Product');
const conFoto = schemas.filter(s => s.image);
console.log('tarjetas con foto:', (html.match(/class="photo custom"/g) || []).length, '| placeholders:', (html.match(/class="photo placeholder"/g) || []).length, '| JSON-LD con image:', conFoto.length, '| JSON-LD total:', schemas.length);
assert.equal((html.match(/class="photo custom"/g) || []).length, 14);
assert.equal((html.match(/class="photo placeholder"/g) || []).length, 406);
assert.equal(conFoto.length, 14);
for (const [id, file] of [[20, '0020-foto-local-a.jpg'], [21, '0021-foto-local-b.jpg']]) {
  const p = withPhoto.find(x => Number(x.id) === id);
  assert(schemas.find(s => s.name === p.name).image.includes('https://elitescentsrd.github.io/img/productos/' + file), 'JSON-LD debe usar la URL absoluta de la foto local de ' + p.name);
  assert(html.includes('url(&quot;/img/productos/thumbs/' + file.replace('.jpg', '.webp') + '&quot;)'), 'La tarjeta debe usar la miniatura del sitio de ' + p.name);
}
for (const p of withPhoto.slice(0, 12)) assert(schemas.find(s => s.name === p.name).image.includes(p.image_url), 'JSON-LD debe usar la foto individual de ' + p.name);
assert(!html.includes('/pages/page-'), 'no debe haber láminas en el HTML');
assert(!/"page":|"slot":/.test(html), 'page/slot no deben salir en el HTML');
// Oferta: precio anterior tachado, precio de oferta, etiqueta del evento y validez en JSON-LD (el resto no muestra oferta).
{
  const offerCard = html.match(/<article class="perfume" id="producto-30"[\s\S]*?<\/article>/)[0];
  assert(offerCard.includes('<small class="price-was">Antes <s>RD$4,500</s></small>') && offerCard.includes('<strong>Ahora RD$4,000</strong>'), 'La tarjeta debe mostrar Antes (tachado) y Ahora');
  assert(offerCard.includes('OFERTA · Evento de prueba'), 'La tarjeta debe mostrar la etiqueta del evento');
  assert.equal((html.match(/class="offer-badge"/g) || []).length, 1, 'Solo el producto en oferta debe tener etiqueta');
  const offerSchema = schemas.find(s => s.name === withPhoto.find(x => Number(x.id) === 30).name);
  assert.equal(offerSchema.offers.price, '4000'); assert.equal(offerSchema.offers.priceValidUntil, '2030-01-01');
  const publicProducts = JSON.parse(html.match(/<script type="application\/json" id="preRenderedProducts">([\s\S]*?)<\/script>/)[1]);
  const p30 = publicProducts.find(p => Number(p.id) === 30); assert.equal(p30.original_price, 'RD$4,500'); assert.equal(p30.price, 'RD$4,000');
  assert(publicProducts.every(p => !('created_at' in p) && !('updated_at' in p) && !('active' in p) && !('page' in p)), 'El JSON público solo debe llevar los campos previstos');
}
console.log('JSON-LD y tarjetas correctos: 12 fotos de Supabase + 2 del sitio, la URL de lámina se ignoró, 406 placeholders.');
