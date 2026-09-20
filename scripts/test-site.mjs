import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const [html, template, css, js, enrichmentText] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/index.template.html', 'utf8'),
  readFile('tienda.css', 'utf8'),
  readFile('tienda.js', 'utf8'),
  readFile('data/product-enrichment.json', 'utf8')
]);
const enrichment = JSON.parse(enrichmentText);
new Script(js,{filename:'tienda.js'});

const products = JSON.parse(html.match(/<script type="application\/json" id="preRenderedProducts">([\s\S]*?)<\/script>/)?.[1] || '[]');
const productSchemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map(match => JSON.parse(match[1]))
  .filter(item => item['@type'] === 'Product');

assert.equal(products.length, 420, 'Deben pre-renderizarse los 420 productos');
for(const p of products){assert(p.id!=null);assert(String(p.name||'').trim());assert(String(p.price||'').match(/\d/));}
assert.equal((html.match(/data-product-id=/g) || []).length, 420, 'Debe existir una tarjeta estática por producto');
for(const p of products) assert(html.includes('data-open-product="'+p.id+'"'),'Falta Ver detalles: '+p.name);
assert.equal(productSchemas.length, 420, 'Debe existir un Product JSON-LD por producto');
assert(productSchemas.every(item => item.name && item.image?.length && item.brand?.name && item.offers?.priceCurrency === 'DOP'));
assert.equal((html.match(/US\$\d+ aprox\./g) || []).length, 420, 'Cada tarjeta debe mostrar el precio aproximado en USD');
assert(template.includes('<option value="system">Sistema</option>'));
assert(template.includes('<option value="light">Claro</option>'));
assert(template.includes('<option value="dark">Oscuro</option>'));
assert(!template.toLowerCase().includes('confirmar la autenticidad'));
assert(css.includes('aspect-ratio:4/3'), 'El recorte del modal debe excluir textos y precios del catálogo');
assert(js.includes("applyTheme(preferredTheme())"), 'El tema elegido debe inicializarse');
assert(js.includes("$('#dialogPriceUsd').textContent=usdPrice(p)"), 'El modal debe mostrar USD');
assert(js.includes('function openProduct(p)'));
assert(js.includes('function addToCart(p)'));
assert(template.includes('id="dialogAddCart"'));
const checkout=await readFile('checkout.html','utf8'),customer=await readFile('customer.js','utf8');
assert(checkout.includes('id="placeOrder"'));
assert(customer.includes('/rest/v1/rpc/place_customer_order'));
assert(customer.includes("CART_KEY='elite-scents-cart-v3'"));
assert.equal(Object.keys(enrichment).length, 420, 'Cada producto debe tener una ficha de notas con su fuente');
assert.equal(products.filter(product => product.notes_top?.length && product.notes_heart?.length && product.notes_base?.length).length, 420, 'Los 420 productos deben tener salida, corazón y fondo');
assert(products.every(product => ![...product.notes_top, ...product.notes_heart, ...product.notes_base].includes('Información pendiente')), 'No deben quedar notas pendientes');
assert(Object.values(enrichment).every(item => /^https:\/\//.test(item.source)), 'Cada ficha debe registrar una fuente web');

console.log('Pruebas superadas: 420 productos con notas y fuentes, JSON-LD, USD, temas y recorte limpio.');
