import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, template, css, js] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/index.template.html', 'utf8'),
  readFile('tienda.css', 'utf8'),
  readFile('tienda.js', 'utf8')
]);

const products = JSON.parse(html.match(/<script type="application\/json" id="preRenderedProducts">([\s\S]*?)<\/script>/)?.[1] || '[]');
const productSchemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map(match => JSON.parse(match[1]))
  .filter(item => item['@type'] === 'Product');

assert.equal(products.length, 420, 'Deben pre-renderizarse los 420 productos');
assert.equal((html.match(/data-product-id=/g) || []).length, 420, 'Debe existir una tarjeta estática por producto');
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
assert.equal(products.filter(product => product.notes_top?.length && product.notes_heart?.length && product.notes_base?.length).length, 5, 'El piloto debe enriquecer exactamente cinco productos verificados');
assert(products.slice(0, 5).every(product => ![...product.notes_top, ...product.notes_heart, ...product.notes_base].includes('Información pendiente')), 'El piloto no debe usar notas de relleno');

console.log('Pruebas superadas: 420 productos, JSON-LD, USD, temas, recorte limpio y 5 fichas verificadas.');
