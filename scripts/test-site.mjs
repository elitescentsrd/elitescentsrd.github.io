import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Script } from 'node:vm';
import { imageSize, imageProblems } from './check-product-images.mjs';

const [html, template, css, js, enrichmentText, pricingText, positionsText] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/index.template.html', 'utf8'),
  readFile('tienda.css', 'utf8'),
  readFile('tienda.js', 'utf8'),
  readFile('data/product-enrichment.json', 'utf8'),
  readFile('data/la-grada-pricing-2026.json', 'utf8'),
  readFile('data/product-positions.json', 'utf8')
]);
const enrichment = JSON.parse(enrichmentText);
const pricing = JSON.parse(pricingText);
// page/slot son datos internos de la auditoría de precios; no forman parte del HTML público.
const positions = JSON.parse(positionsText);
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
  const position=positions[p.id];
  assert(position,'Falta posición interna de auditoría para '+p.name);
  const page=pricing.costs_by_page[String(position.page)];
  assert(page,'Falta página de costo para '+p.name);
  const raw=page[Number(position.slot)];
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

// --- Migración de fotografías: placeholder, carga por lote y ausencia de láminas ---
assert(products.every(p=>!('page' in p)&&!('slot' in p)),'El JSON público no debe exponer page/slot');
assert(!/\/pages\/page-/.test(html),'index.html no debe referir a láminas /pages/page-XX');
assert(!/\/pages\/page-/.test(template),'La plantilla no debe referir a láminas');
assert(!js.includes('/pages/page-')&&!js.includes('pages/page-'),'tienda.js no debe construir rutas de láminas');
assert(js.includes("wrap.classList.add('placeholder')"),'tienda.js debe mostrar el placeholder si no hay foto');
assert(css.includes('.photo.placeholder')&&css.includes('Foto próximamente'),'El CSS debe definir el placeholder');
const withoutPhoto=products.filter(p=>!p.image_url).length;
assert.equal((html.match(/class="photo placeholder"/g)||[]).length,withoutPhoto,'Cada producto sin foto debe usar el placeholder');
assert.equal((html.match(/class="photo custom"/g)||[]).length,products.length-withoutPhoto,'Cada producto con foto debe usar su imagen');
for(const legacy of ['catalogo.html','catalogo-app.js','catalogo-viewer.js','site-features.js','pages','catalogo-data-1.js','catalogo-1.webp'])
  assert(!existsSync(legacy),'El archivo legado debe estar archivado, no en la raíz pública: '+legacy);
assert(existsSync('archive/catalogo-legacy/catalogo.html'),'La copia archivada del catálogo antiguo debe conservarse');

// Carga por lote en el panel administrativo.
assert(adminHtml.includes('id="batch-form"')&&adminHtml.includes('id="batch-files"'),'Admin debe ofrecer carga de fotos por lote');
assert(adminHtml.includes('accept="image/jpeg,image/png,image/webp"'));
assert(adminJs.includes('const MAX_IMAGE_BYTES = 3 * 1024 * 1024')&&adminJs.includes('MIN_IMAGE_SIDE = 500')&&adminJs.includes('BATCH_MAX = 36'),'Admin debe validar peso, tamaño mínimo y máximo por lote');
assert(adminJs.includes('function batchId(name)'),'Admin debe tomar el ID desde el nombre del archivo');
assert(adminJs.includes('body: JSON.stringify({ image_url: url })'),'El lote solo debe actualizar image_url');
assert(!/name="page"|name="slot"/.test(adminHtml)&&!/\bpage:Number|\bslot:Number/.test(adminJs),'El panel ya no debe editar page/slot');
// El panel no debe corromper precios con varias presentaciones.
{
  const src=adminJs.slice(adminJs.indexOf('function money('),adminJs.indexOf('const MAX_IMAGE_BYTES'));
  const normalizePrice=new Function(src+'; return normalizePrice;')();
  assert.equal(normalizePrice('RD$3,550 / RD$4,150'),'RD$3,550 / RD$4,150');
  assert.equal(normalizePrice('7500'),'RD$7,500');
  assert.equal(normalizePrice('RD$4,900'),'RD$4,900');
  assert.equal(normalizePrice('abc'),'');
}
// Validador de imágenes (cabeceras reales).
{
  const png=Buffer.alloc(33);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png);png.writeUInt32BE(900,16);png.writeUInt32BE(900,20);
  assert.deepEqual(imageSize(png),{type:'png',width:900,height:900});
  const jpg=Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x03,0x84,0x03,0x84,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,0x01]);
  assert.deepEqual(imageSize(jpg),{type:'jpg',width:900,height:900});
  assert.deepEqual(imageProblems({url:'https://x.test/a.png',status:200,contentType:'image/png',body:png}),[]);
  assert(imageProblems({url:'https://x.test/pages/page-02.webp',status:200,contentType:'image/webp',body:png}).length,'Una lámina debe rechazarse');
  assert(imageProblems({url:'http://x.test/a.png',status:200,contentType:'image/png',body:png}).length,'HTTP debe rechazarse');
  assert(imageProblems({url:'https://x.test/a.gif',status:200,contentType:'image/gif',body:png}).length,'Un GIF debe rechazarse');
  const small=Buffer.from(png);small.writeUInt32BE(300,16);
  assert(imageProblems({url:'https://x.test/a.png',status:200,contentType:'image/png',body:small}).length,'Menos de 500x500 debe rechazarse');
}

// --- Privacidad: el texto público debe coincidir con los flujos reales ---
const privacy=await readFile('privacidad.html','utf8');
for(const term of ['cuenta','cédula','dirección','teléfono','pedidos','MFA','WhatsApp','Supabase','Ley 172-13','conserva'])
  assert(privacy.toLowerCase().includes(term.toLowerCase()),'La política de privacidad debe mencionar: '+term);
assert(!/no crean cuentas|los clientes no crean/i.test(privacy),'La política no puede afirmar que no existen cuentas');
assert(privacy.includes('eliminación'),'La política debe explicar cómo pedir la eliminación');

// --- Publicación: solo archivos públicos y protección de la RPC ---
const workflow=await readFile('.github/workflows/pages.yml','utf8');
assert(workflow.includes('path: _site'),'Pages debe publicar solo _site/');
assert(!/path:\s*\.\s*$/m.test(workflow),'Pages no debe publicar la raíz del repositorio');
assert(workflow.includes('npm run site'),'El workflow debe generar el artefacto público');
const lockSql=await readFile('supabase/proposed/04_lock_down_order_rpc.sql','utf8');
assert(/revoke execute on function public\.place_customer_order\(jsonb\) from public, anon/i.test(lockSql),'La RPC debe revocar EXECUTE a anon');
assert(/grant execute on function public\.place_customer_order\(jsonb\) to authenticated/i.test(lockSql),'La RPC debe conservar EXECUTE para authenticated');
const lockMigration=await readFile('supabase/migrations/20260920120000_lock_down_place_customer_order.sql','utf8');
assert(/revoke execute on function public\.place_customer_order\(jsonb\) from public, anon/i.test(lockMigration)&&/grant\s+execute on function public\.place_customer_order\(jsonb\) to authenticated/i.test(lockMigration),'La migración versionada debe revocar anon y conceder authenticated');
assert(lockMigration.includes('to_regprocedure'),'La migración debe ser idempotente y no fallar si la función no existe');
assert(existsSync('supabase/verification/01_audit_queries.sql'),'Deben existir las consultas de auditoría de Supabase');
assert(!/insert\s+into|update\s+public|delete\s+from|drop\s+|alter\s+/i.test((await readFile('supabase/verification/01_audit_queries.sql','utf8')).replace(/--.*$/gm,'')),'Las consultas de auditoría deben ser de solo lectura');
const readme=await readFile('README.md','utf8');
assert(!/ozowziumk|service_role\s*=|\/admin\.html/i.test(readme),'El README público no debe exponer referencia de proyecto ni ruta del panel');
console.log('Pruebas de migración de fotos, privacidad y publicación superadas.');
