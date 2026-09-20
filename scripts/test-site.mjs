import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const [html, template, css, js, enrichmentText, pricingText] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/index.template.html', 'utf8'),
  readFile('tienda.css', 'utf8'),
  readFile('tienda.js', 'utf8'),
  readFile('data/product-enrichment.json', 'utf8'),
  readFile('data/la-grada-pricing-2026.json', 'utf8')
]);
const enrichment = JSON.parse(enrichmentText);
const pricing = JSON.parse(pricingText);
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
assert(productSchemas.every(item => item.name && item.brand?.name && item.offers?.priceCurrency === 'DOP'));
// El JSON-LD nunca debe declarar una lámina completa (/pages/page-XX.webp)
// como foto de un producto individual. Mientras un producto no tenga foto
// propia, "image" debe estar ausente, no apuntar a la lámina.
assert(productSchemas.every(item => !item.image || item.image.every(url => !url.includes('/pages/page-'))), 'El JSON-LD no debe usar la lámina completa como imagen de producto');
assert.equal((html.match(/US\$\d+ aprox\./g) || []).length, 420, 'Cada tarjeta debe mostrar el precio aproximado en USD');
// catalogo.html (el visor de las 36 láminas completas) ya no se publica en
// _site/; el enlace del footer no debe reaparecer por accidente.
assert(!template.includes('/catalogo.html'), 'La plantilla no debe enlazar catalogo.html: ya no se publica');
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



// Admin order notification regression checks
const adminHtml=await readFile('admin.html','utf8');
const adminJs=await readFile('admin.js','utf8');
assert(adminHtml.includes('id="enable-order-notifications"'),'Admin debe ofrecer activar notificaciones');
assert(adminJs.includes('function checkNewOrders()'),'Admin debe comprobar pedidos nuevos');
assert(adminJs.includes("Notification.permission==='granted'"),'Admin debe respetar permiso de notificaciones');

function numericPrices(value){return (String(value).match(/[0-9][0-9,.]*/g)||[]).map(v=>Number(v.replace(/[,.]/g,''))).filter(Number.isFinite)}
function expectedMarkup(cost){
  const row=pricing.pricing_rule.find(rule=>rule.max_cost===null || cost<=rule.max_cost);
  assert(row,'Debe existir una regla de precio para costo '+cost);
  return row.markup;
}
assert.equal(pricing.items,420,'La auditoría de La Grada debe cubrir 420 productos');
assert.equal(Object.values(pricing.costs_by_page).reduce((n,row)=>n+row.length,0),420,'El mapa de costos debe tener 420 posiciones');
for(const p of products){
  const page=pricing.costs_by_page[String(p.page)];
  assert(page,'Falta página de costo para '+p.name);
  const raw=page[Number(p.slot)];
  assert(raw!==undefined,'Falta costo para '+p.name);
  const costs=Array.isArray(raw)?raw:[raw];
  const sells=numericPrices(p.price);
  assert.equal(sells.length,costs.length,'Presentaciones no coinciden para '+p.name);
  costs.forEach((cost,i)=>assert.equal(sells[i],cost+expectedMarkup(cost),'Precio fuera de política para '+p.name));
}
assert(checkout.includes('name="cedula" maxlength="30" autocomplete="off" required'),'La cédula debe ser obligatoria');
assert(customer.includes('profile.reportValidity()'),'El checkout debe validar los datos antes de ordenar');
assert(adminJs.includes("'preparando'") && adminJs.includes("'enviado'"),'Admin debe usar estados válidos');
assert(adminJs.includes('estimated_delivery'),'Admin debe permitir guardar entrega estimada');
assert(adminJs.includes('orderWhatsapp(o)'),'Admin debe permitir contactar el pedido por WhatsApp');
