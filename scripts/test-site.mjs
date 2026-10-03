import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Script } from 'node:vm';
import { imageSize, imageProblems } from './check-product-images.mjs';
import { renderProductPage, renderDirectory, productPath, productUrl, slugify, SITE_URL } from './lib/seo.mjs';

const [html, template, css, js, enrichmentText, catalogText, referenciaText] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/index.template.html', 'utf8'),
  readFile('tienda.css', 'utf8'),
  readFile('tienda.js', 'utf8'),
  readFile('data/product-enrichment.json', 'utf8'),
  readFile('perfumes.json', 'utf8'),
  readFile('data/precios-referencia-2026-09-28.json', 'utf8')
]);
const enrichment = JSON.parse(enrichmentText);
// Precio normal público de cada perfume el 28-sep (sin costos): referencia para detectar un precio escrito por error.
const referencia = JSON.parse(referenciaText).precios;
// Precios públicos después del catálogo de La Grada de sept. 2026 (sin costos) y perfumes que se pueden ocultar mientras se confirman.
const precios2609 = JSON.parse(await readFile('data/precios-2026-09.json', 'utf8'));
// Perfumes nuevos del catálogo de La Grada (números 421 en adelante): existen en la tienda cuando se aplica su script SQL.
const nuevos2609 = JSON.parse(await readFile('data/perfumes-nuevos-2026-09.json', 'utf8'));
const idsNuevos = new Set(Object.keys(nuevos2609.perfumes).map(Number)), notasPendientes = new Set(nuevos2609.notas_pendientes.map(Number));
const inspirado = JSON.parse(await readFile('data/inspirado-en.json', 'utf8')).perfumes;
new Script(js,{filename:'tienda.js'});

// El catálogo público está en perfumes.json; la portada trae solo las primeras tarjetas y las secciones destacadas,
// y la ficha Product (JSON-LD) de cada perfume está en su propia página.
const products = JSON.parse(catalogText);
const relatedOf = p => p.brand ? products.filter(x => x.brand === p.brand && x.id !== p.id).slice(0, 6) : [];
const productSchemas = products.map(p => [...renderProductPage(p, relatedOf(p)).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map(match => JSON.parse(match[1])).find(item => item['@type'] === 'Product'));
const staticCards = [...html.matchAll(/<article class="perfume"( role="listitem"| id="producto-(\d+)") data-product-id="(\d+)">([\s\S]*?)<\/article>/g)]
  .map(m => ({ shelf: Boolean(m[1].includes('listitem')), id: Number(m[3]), body: m[4] }));
const gridCards = staticCards.filter(c => !c.shelf);

// Catálogo: 420 perfumes + los nuevos de La Grada; los de precios2609.ocultos pueden estar ocultos (active = false) y los
// nuevos aparecen cuando se aplica su script SQL (antes de eso la tienda sigue con 420).
const BASE = 420, TOTAL = BASE + idsNuevos.size, N = products.length, ocultables = new Set(precios2609.ocultos.map(Number));
assert(N >= BASE - ocultables.size && N <= TOTAL, 'Deben pre-renderizarse entre ' + (BASE - ocultables.size) + ' y ' + TOTAL + ' productos (hay ' + N + ')');
{
  const visibles = new Set(products.map(p => Number(p.id)));
  const faltan = [...Object.keys(enrichment).map(Number), ...idsNuevos].filter(id => !visibles.has(id) && !ocultables.has(id) && !idsNuevos.has(id));
  assert.deepEqual(faltan, [], 'Solo pueden faltar perfumes de la lista de ocultos (data/precios-2026-09.json) o nuevos sin aplicar');
  const nuevosVisibles = [...idsNuevos].filter(id => visibles.has(id)).length;
  assert(nuevosVisibles === 0 || nuevosVisibles === idsNuevos.size, 'Los perfumes nuevos llegan todos juntos (hay ' + nuevosVisibles + ' de ' + idsNuevos.size + ')');
  assert.equal(Math.min(...idsNuevos), nuevos2609.primer_id); assert.equal(Math.max(...idsNuevos), nuevos2609.ultimo_id);
  for (const p of products.filter(x => idsNuevos.has(Number(x.id)))) {
    const n = nuevos2609.perfumes[String(p.id)];
    assert.equal(p.name, n.name, 'Nombre del perfume nuevo #' + p.id);
    assert(p.image_url && p.image_url.endsWith(n.foto.replace('img/productos/', '')), 'Foto del perfume nuevo #' + p.id);
  }
}
for(const p of products){assert(p.id!=null);assert(String(p.name||'').trim());assert(String(p.price||'').match(/\d/));}
// Portada liviana: las primeras 24 tarjetas del catálogo (en orden), sin fichas Product repetidas y con el catálogo aparte.
assert.deepEqual(gridCards.map(c => c.id), products.slice(0, 24).map(p => Number(p.id)), 'La portada trae las primeras 24 tarjetas del catálogo');
assert.equal((html.match(/data-product-id=/g) || []).length, staticCards.length, 'Solo hay tarjetas del catálogo y de las secciones destacadas');
for (const c of staticCards) assert(c.body.includes('data-open-product="' + c.id + '"'), 'Falta Ver detalles en la tarjeta #' + c.id);
assert(!/"@type":"Product"/.test(html), 'Las fichas Product van en la página de cada perfume, no repetidas en la portada');
const catalogInfo = JSON.parse(html.match(/<script type="application\/json" id="catalogInfo">([\s\S]*?)<\/script>/)[1]);
assert(/^\/perfumes\.json\?v=[a-f0-9]{12}$/.test(catalogInfo.src) && catalogInfo.total === N, 'La portada indica el catálogo con su versión');
assert(html.includes('<link rel="preload" href="' + catalogInfo.src + '" as="fetch" type="application/json" crossorigin="anonymous">'), 'El catálogo se pide desde el <head>');
assert(Buffer.byteLength(html) < 200 * 1024, 'La portada debe pesar menos de 200 KB (hoy ' + Math.round(Buffer.byteLength(html) / 1024) + ' KB)');
assert(!html.includes('id="preRenderedProducts"'), 'El catálogo completo ya no va dentro de la portada');
assert.equal(productSchemas.filter(Boolean).length, N, 'Debe existir un Product JSON-LD por producto (en su página)');
assert(productSchemas.every(item => item.name && item.brand?.name && item.offers?.priceCurrency === 'DOP'));
// El JSON-LD nunca debe declarar una lámina completa (/pages/page-XX.webp)
// como foto de un producto individual. Mientras un producto no tenga foto
// propia, "image" debe estar ausente, no apuntar a la lámina.
assert(productSchemas.every(item => !item.image || item.image.every(url => !url.includes('/pages/page-'))), 'El JSON-LD no debe usar la lámina completa como imagen de producto');
assert.equal((html.match(/US\$\d+ aprox\./g) || []).length, staticCards.length, 'Cada tarjeta debe mostrar el precio aproximado en USD');
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
assert(/function openProduct\(p[,)]/.test(js), 'tienda.js debe abrir la ficha del perfume');
assert(js.includes('function addToCart(p)'));
assert(template.includes('id="dialogAddCart"'));
const checkout=await readFile('checkout.html','utf8'),customer=await readFile('customer.js','utf8');
assert(checkout.includes('id="placeOrder"'));
assert(customer.includes('/rest/v1/rpc/place_customer_order'));
assert(customer.includes("CART_KEY='elite-scents-cart-v3'"));
assert.equal(Object.keys(enrichment).length, TOTAL - notasPendientes.size, 'Cada producto debe tener una ficha de notas con su fuente (menos los nuevos con notas pendientes)');
assert(!Object.keys(enrichment).some(id => notasPendientes.has(Number(id))), 'Un perfume con notas pendientes no tiene ficha');
assert.equal(products.filter(product => product.notes_top?.length && product.notes_heart?.length && product.notes_base?.length).length, products.filter(p => !notasPendientes.has(Number(p.id))).length, 'Todos los productos deben tener salida, corazón y fondo (menos los nuevos con notas pendientes)');
assert(products.every(product => ![...product.notes_top, ...product.notes_heart, ...product.notes_base].includes('Información pendiente')), 'No deben quedar notas pendientes');
assert(Object.values(enrichment).every(item => /^https:\/\//.test(item.source)), 'Cada ficha debe registrar una fuente web');

// «Inspirado en…»: cada referencia tiene su fuente y el script SQL escribe exactamente estas.
{
  for (const [id, item] of Object.entries(inspirado)) {
    assert(/^https:\/\//.test(item.fuente), 'La referencia de #' + id + ' debe tener una fuente web');
    assert(item.referencia.length >= 2 && item.referencia.length <= 120, 'Referencia de #' + id);
    assert(Number(id) <= BASE ? enrichment[id] : idsNuevos.has(Number(id)), 'La referencia de #' + id + ' es de un perfume de la tienda');
  }
  for (const p of products) if (p.inspired_by) assert(p.inspired_by.length >= 2 && p.inspired_by.length <= 120, 'Referencia válida en #' + p.id);
  const sql = await readFile(nuevos2609.aplicar_con, 'utf8');
  const bloque = nombre => sql.slice(sql.indexOf('insert into ' + nombre + ' ('), sql.indexOf('\n\n', sql.indexOf('insert into ' + nombre + ' (')));
  const filasInspirados = [...bloque('inspirados').matchAll(/^\s+\((\d+), '((?:[^']|'')*)'\)[,;]/gm)].map(m => [m[1], m[2].replace(/''/g, "'")]);
  assert.deepEqual(Object.fromEntries(filasInspirados), Object.fromEntries(Object.entries(inspirado).filter(([id]) => Number(id) <= BASE).map(([id, v]) => [id, v.referencia])), 'El script escribe las referencias de data/inspirado-en.json');
  const filasNuevos = [...bloque('nuevos').matchAll(/^\s+\((\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'/gm)];
  assert.equal(filasNuevos.length, idsNuevos.size, 'El script agrega todos los perfumes nuevos');
  for (const [, id, name, brand, price] of filasNuevos) {
    const n = nuevos2609.perfumes[id];
    assert(n && n.name === name.replace(/''/g, "'") && n.brand === brand.replace(/''/g, "'") && n.price === price, 'Perfume nuevo #' + id + ' igual en el script y en el archivo de datos');
    assert(/^RD\$[0-9,]+$/.test(price), 'Precio público del perfume nuevo #' + id);
  }
  assert(!/costo|margen|ganancia/i.test(JSON.stringify(nuevos2609.perfumes)) && !/"cost/i.test(JSON.stringify(nuevos2609)), 'El archivo público de perfumes nuevos no tiene costos');
}

console.log('Pruebas superadas: ' + N + ' productos visibles (de ' + TOTAL + ') con notas y fuentes, JSON-LD, USD, temas y recorte limpio.');



// Admin order notification regression checks
const adminHtml=await readFile('admin.html','utf8');
const adminJs=await readFile('admin.js','utf8');
assert(adminHtml.includes('id="enable-order-notifications"'),'Admin debe ofrecer activar notificaciones');
assert(adminJs.includes('function checkNewOrders()'),'Admin debe comprobar pedidos nuevos');
assert(adminJs.includes("Notification.permission==='granted'"),'Admin debe respetar permiso de notificaciones');

function numericPrices(value){return (String(value).match(/[0-9][0-9,.]*/g)||[]).map(v=>Number(v.replace(/[,.]/g,''))).filter(Number.isFinite)}
assert.equal(Object.keys(referencia).length,BASE,'La referencia pública cubre los 420 perfumes');
assert(!/cost|costo|margen|markup/i.test(JSON.stringify(referencia)),'La referencia de precios no tiene costos');
assert(!existsSync('data/la-grada-pricing-2026.json'),'Los costos del catálogo anterior no deben estar en el repositorio público');
const fueraDeRango=[];
for(const p of products){
  if(idsNuevos.has(Number(p.id))){
    const esperado=numericPrices(nuevos2609.perfumes[String(p.id)].price),sells=numericPrices(p.original_price||p.price);
    assert.equal(sells.length,esperado.length,'Presentaciones del perfume nuevo '+p.name);
    sells.forEach((v,i)=>{if(!(v>=esperado[i]/2&&v<=esperado[i]*2))fueraDeRango.push(p.name+': RD$'+v+' (esperado cerca de RD$'+esperado[i]+')')});
    continue;
  }
  // El precio normal lo decide el dueño en el panel: puede ser el de la referencia pública del 28-sep, el recomendado tras
  // el catálogo de sept. 2026 u otro que ponga a mano. Solo se rechaza uno absurdo (menos de la mitad o más del doble de
  // esas referencias), que casi siempre es un error al escribir; un precio cambiado a mano no debe frenar la publicación.
  const sells=numericPrices(p.original_price||p.price);
  const refs=[numericPrices(referencia[String(p.id)]||''),numericPrices(precios2609.precios_recomendados[String(p.id)]||'')].filter(r=>r.length===sells.length);
  assert(refs.length,'Presentaciones no coinciden para '+p.name);
  sells.forEach((v,i)=>{
    const valores=refs.map(r=>r[i]),minimo=Math.min(...valores)/2,maximo=Math.max(...valores)*2;
    if(!(v>=minimo&&v<=maximo))fueraDeRango.push(p.name+': RD$'+v+' (esperado entre RD$'+minimo+' y RD$'+maximo+')');
  });
}
assert.equal(fueraDeRango.length,0,'Precios fuera de rango (¿error al escribir en el panel?):\n'+fueraDeRango.join('\n'));
{
  // data/precios-2026-09.json y el script SQL que lo aplica deben decir lo mismo (sin costos: solo precios públicos).
  const sql=await readFile(precios2609.aplicar_con,'utf8');
  const bloque=nombre=>sql.slice(sql.indexOf(nombre+'('),sql.indexOf('),\n\n',sql.indexOf(nombre+'(')));
  const filas=nombre=>[...bloque(nombre).matchAll(/^\s+\((\d+)(?:::bigint)?((?:, '[^']*')*)\)/gm)].map(m=>[m[1],...[...m[2].matchAll(/'([^']*)'/g)].map(x=>x[1])]);
  const subir=Object.fromEntries(filas('subir').map(([id,,nuevo])=>[id,nuevo]));
  const ofertas=Object.fromEntries(filas('ofertas').map(([id,antes,ahora])=>[id,{antes,ahora}]));
  assert.deepEqual(subir,precios2609.subir,'El SQL debe subir exactamente los precios de data/precios-2026-09.json');
  assert.deepEqual(ofertas,precios2609.ofertas,'El SQL debe crear exactamente las ofertas de data/precios-2026-09.json');
  assert.deepEqual(filas('ocultar').map(([id])=>Number(id)),precios2609.ocultos,'El SQL debe ocultar exactamente los perfumes de data/precios-2026-09.json');
  // Cada presentación sube al precio recomendado (o se queda igual si ese tamaño no cambia) y al menos una sube.
  for(const [id,antes,nuevo] of filas('subir')){
    const a=numericPrices(antes),n=numericPrices(nuevo),r=numericPrices(precios2609.precios_recomendados[id]);
    assert(n.length===a.length&&n.every((v,i)=>v===r[i]||v===a[i])&&n.some((v,i)=>v>a[i]),'Subida incoherente para #'+id+': '+antes+' → '+nuevo);
  }
  // Cada oferta es el precio recomendado y es menor que el precio de hoy en todas sus presentaciones.
  for(const [id,{antes,ahora}] of Object.entries(precios2609.ofertas)){
    const a=numericPrices(antes),b=numericPrices(ahora);
    assert(ahora===precios2609.precios_recomendados[id]&&a.length===b.length&&b.every((v,i)=>v<a[i]),'Oferta incoherente para #'+id+': '+antes+' → '+ahora);
  }
  assert(!/costo|cost/i.test(JSON.stringify(precios2609.precios_recomendados))&&!('costs_by_page' in precios2609),'El archivo público de precios no debe incluir costos');
  assert(/^\s*with modo\(deshacer\) as \(values \(false\)\)/m.test(sql),'El script SQL debe quedar en modo aplicar (deshacer = false)');
}
{
  // Script del 28-sep: los del catálogo de La Grada quedan disponibles, los que no están quedan visibles como agotados,
  // y algunos precios se ajustan a la competencia (solo precios públicos, sin costos).
  const sql=await readFile('supabase/migrations/20260928120000_disponibilidad_y_precios.sql','utf8');
  const bloque=nombre=>{const i=sql.indexOf('insert into '+nombre+' (');assert(i>0,'Falta la lista '+nombre);return sql.slice(i,sql.indexOf('\n\n',i))};
  const ids=nombre=>[...bloque(nombre).matchAll(/^\s+\((\d+)\)[,;]/gm)].map(m=>Number(m[1]));
  const catalogo=ids('catalogo'),agotados=ids('agotados');
  assert.deepEqual(catalogo,Object.keys(precios2609.precios_recomendados).map(Number).sort((a,b)=>a-b),'El catálogo del script debe ser el de data/precios-2026-09.json');
  assert.deepEqual(agotados,[...precios2609.ocultos].sort((a,b)=>a-b),'Los agotados del script deben ser los que no están en el catálogo de La Grada');
  assert.equal(new Set([...catalogo,...agotados,...Object.keys(enrichment).map(Number).filter(id=>id<=BASE)]).size,BASE,'Catálogo + agotados deben ser los 420 perfumes');
  const precios=[...bloque('precios').matchAll(/^\s+\((\d+), '([^']*)', '([^']*)'\)[,;]/gm)];
  assert(precios.length>0&&precios.every(([,,antes,nuevo])=>antes!==nuevo&&numericPrices(antes).length===numericPrices(nuevo).length&&/^RD\$[0-9,]+( \/ RD\$[0-9,]+)*$/.test(nuevo)),'Cada precio del script debe cambiar y tener las mismas presentaciones');
  assert(/select false as deshacer;/.test(sql)&&/-- FIN\s*$/.test(sql),'El script del 28-sep debe quedar en modo aplicar y completo');
  assert(!/costo|cost|margen|ganancia/i.test(sql.replace(/--[^\n]*/g,'')),'El script no debe incluir costos ni márgenes (fuera de los comentarios)');
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
{
  const byId=new Map(products.map(p=>[Number(p.id),p]));
  for(const c of staticCards){
    const p=byId.get(c.id); assert(p,'Tarjeta de un perfume que no está en el catálogo: #'+c.id);
    assert(p.image_url?c.body.includes('<div class="photo custom"><img src="'+p.image_url.replace('/img/productos/','/img/productos/thumbs/').replace(/\.(jpe?g|png)$/i,'.webp')+'"'):c.body.includes('class="photo placeholder"'),'Foto o placeholder de la tarjeta #'+c.id);
  }
}
for(const legacy of ['catalogo.html','catalogo-app.js','catalogo-viewer.js','site-features.js','pages','catalogo-data-1.js','catalogo-1.webp'])
  assert(!existsSync(legacy),'El archivo legado debe estar archivado, no en la raíz pública: '+legacy);
assert(existsSync('archive/catalogo-legacy/catalogo.html'),'La copia archivada del catálogo antiguo debe conservarse');

// Rendimiento: las fotos de las tarjetas son miniaturas con carga diferida (el celular las baja al acercarse).
{
  const cardImgs=[...html.matchAll(/<div class="photo custom"><img ([^>]*)>/g)].map(m=>m[1]);
  assert(cardImgs.length>0&&cardImgs.every(a=>/src="\/img\/productos\/thumbs\/[^"]+\.webp"/.test(a)&&a.includes('loading="lazy"')&&a.includes('decoding="async"')&&/alt="Frasco de [^"]+"/.test(a)&&a.includes('width="420" height="420"')),'Fotos de tarjeta: miniatura, carga diferida, tamaño y texto alternativo');
  assert(!/background-image:url\(&quot;\/img\/productos|data-bg=/.test(html),'Las tarjetas ya no usan fondos CSS para la foto');
}
{
  const { readdir, stat } = await import('node:fs/promises');
  const thumbs=(await readdir('img/productos/thumbs')).filter(f=>f.endsWith('.webp')), fulls=(await readdir('img/productos')).filter(f=>/\.jpg$/i.test(f));
  assert.equal(thumbs.length,TOTAL,'Debe haber una miniatura WebP por perfume ('+TOTAL+')');
  for(const f of fulls) assert(thumbs.includes(f.replace(/\.jpg$/i,'.webp')),'Falta la miniatura de '+f);
  for(const f of thumbs){const s=(await stat('img/productos/thumbs/'+f)).size; assert(s>500&&s<40*1024,'La miniatura debe pesar menos de 40 KB: '+f+' '+s);}
  assert(!/<img src="\/img\/productos\/[0-9]/.test(html),'Las tarjetas no deben usar la foto grande, solo la miniatura');
  // Fotos grandes en WebP (más livianas) para la ficha y la página de cada perfume; el JPG queda para Google y Meta.
  const webps=(await readdir('img/productos/webp')).filter(f=>f.endsWith('.webp'));
  assert.equal(webps.length,TOTAL,'Debe haber una foto WebP por perfume ('+TOTAL+')');
  for(const f of fulls){const w='img/productos/webp/'+f.replace(/\.jpg$/i,'.webp');assert(webps.includes(f.replace(/\.jpg$/i,'.webp')),'Falta la foto WebP de '+f);assert((await stat(w)).size<(await stat('img/productos/'+f)).size,'La foto WebP debe pesar menos que el JPG: '+f)}
  for(const p of products) if(/^\/img\/productos\/[^/]+\.jpg$/.test(p.image_url||'')) assert.equal(p.image_webp,p.image_url.replace('/img/productos/','/img/productos/webp/').replace(/\.jpg$/,'.webp'),'Ruta WebP de #'+p.id);
}
// --- 420 fotos individuales guardadas en el sitio (img/productos/): una por producto, válidas y sin láminas ---
{
  const { readdir } = await import('node:fs/promises');
  const files=(await readdir('img/productos')).filter(f=>/\.(jpe?g|png|webp)$/i.test(f)).sort();
  const byId=new Map();
  for(const f of files){
    const m=/^([0-9]{4,})-[a-z0-9-]+\.(jpe?g|png|webp)$/i.exec(f); assert(m,'Nombre de foto no válido: '+f);
    assert(!byId.has(Number(m[1])),'Foto duplicada para el ID '+Number(m[1])); byId.set(Number(m[1]),f);
  }
  assert.equal(files.length,TOTAL,'Debe haber una foto individual por perfume en img/productos ('+TOTAL+')');
  for(const p of products){
    const f=byId.get(Number(p.id)); assert(f,'Falta la foto de #'+p.id+' '+p.name);
    const buf=await readFile('img/productos/'+f), size=imageSize(buf), kb=buf.length;
    assert(size,'Foto ilegible: '+f); assert(size.width>=500&&size.height>=500,'Foto demasiado pequeña: '+f+' '+size.width+'x'+size.height);
    assert(kb<=3*1024*1024,'Foto de más de 3 MB: '+f);
    assert(p.image_url&&(p.image_url.endsWith('/'+f)||/^https:\/\//.test(p.image_url)),'La tarjeta de #'+p.id+' debe usar su foto');
  }
  assert.equal(withoutPhoto,0,'Ningún producto debe quedar con "Foto próximamente" (todos con foto)');
  const localSchemas=productSchemas.filter(s=>s.image&&s.image.every(u=>/^https:\/\//.test(u)&&!u.includes('/pages/page-')));
  assert.equal(localSchemas.length,N,'Todos los Product JSON-LD deben tener imagen individual absoluta');
}

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
// --- Cuenta de cliente: el correo de confirmación debe volver a la web real, nunca a localhost ---
assert(customer.includes("/auth/v1/signup?redirect_to='+encodeURIComponent(redirectUrl())"),'El registro debe indicar redirect_to');
assert(customer.includes("const SITE_URL='"+SITE_URL+"'"),'Debe existir la URL pública como respaldo');
assert(!/localhost/i.test(customer),'customer.js no debe mencionar localhost');
assert(customer.includes('async function handleAuthRedirect()')&&customer.includes("q.get('access_token')")&&customer.includes('history.replaceState'),'Debe procesar la sesión del enlace de confirmación y limpiar la URL');
assert(customer.includes('/auth/v1/resend?redirect_to='),'Debe poder reenviar el correo de confirmación');
assert(checkout.includes('id="resendConfirm"'),'checkout.html debe incluir el botón de reenvío');
assert(customer.includes("https://wa.me/'+WA+'?text='+encodeURIComponent('Hola Elite Scents RD, acabo de hacer el pedido #'"),'Tras ordenar debe ofrecerse enviar el pedido por WhatsApp');
// Panel: contador de pendientes, sonido y renovación de sesión para no perder avisos tras 1 hora.
assert(adminHtml.includes('id="pending-count"')&&adminJs.includes('function updatePending()')&&adminJs.includes('function beep()'),'El panel debe mostrar pendientes y sonar');
assert(adminJs.includes('async function refreshSession()')&&adminJs.includes('grant_type=refresh_token'),'El panel debe renovar la sesión');
assert(adminJs.includes("digits.length===10)digits='1'+digits"),'WhatsApp del panel debe añadir el código de país 1 a números de 10 dígitos');
// --- MFA (TOTP): QR legible, reintentos y código al entrar ---
{
  const start=customer.indexOf('function qrSource(qr){'),end=customer.indexOf('\n}',start)+2;
  const qrSource=new Function(customer.slice(start,end)+'; return qrSource;')();
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0h10v10H0z" fill="#000"/></svg>';
  for(const input of [svg,'data:image/svg+xml;utf-8,'+svg,'data:image/svg+xml;charset=UTF-8,'+svg]){
    const out=qrSource(input); assert(out.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg'),'El QR debe convertirse a una URL data: codificada');
    assert.equal(decodeURIComponent(out.slice(out.indexOf(',')+1)),svg,'El SVG del QR debe conservarse íntegro');
  }
  assert.equal(qrSource('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
  assert.equal(qrSource('javascript:alert(1)'),'','Un valor no permitido no debe usarse como imagen');
}
assert(customer.includes("f.status!=='verified')await authFetch('/auth/v1/factors/'"),'Debe eliminar factores sin verificar antes de activar de nuevo');
assert(customer.includes('async function finishMfaLogin(code)')&&customer.includes("/challenge'")&&customer.includes("/verify'"),'Al entrar con MFA activo debe pedirse el código');
assert(checkout.includes('id="mfaLoginForm"')&&checkout.includes('id="disableMfa"')&&checkout.includes('id="mfaLink"'),'checkout.html debe incluir el código al entrar, desactivar y abrir en la app');
// --- Descripciones propias: una por producto, con datos reales (nombre, notas), sin texto repetido ---
assert(products.every(p=>String(p.description||'').length>=120&&p.description.includes(p.name)),'Cada producto debe tener una descripción propia con su nombre');
assert(new Set(products.map(p=>p.description)).size>=N-5,'Las descripciones no deben repetirse (salvo productos idénticos)');
assert(productSchemas.every(s=>String(s.description||'').length>=120),'El JSON-LD debe usar la descripción propia');
// --- SEO: marca, páginas por perfume y sitemap ---
{
  const brandBlock=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1])).find(x=>x['@graph']);
  assert(brandBlock,'La portada debe declarar la marca (WebSite + Store) en JSON-LD');
  const org=brandBlock['@graph'].find(x=>x['@type']==='Store'), site=brandBlock['@graph'].find(x=>x['@type']==='WebSite');
  assert(org.name==='Elite Scents RD'&&site.name==='Elite Scents RD','El nombre de la marca debe ser Elite Scents RD');
  assert(org.alternateName.includes('EliteScentsRD')&&org.sameAs.some(u=>u.includes('instagram.com/elite.scentsrd')),'Debe incluir variantes del nombre y la red social');
  assert(/logo-oficial/.test(org.logo.url)&&org.telephone==='+18094333348'&&org.areaServed.name==='República Dominicana','Debe incluir logotipo, teléfono y zona de servicio');
  assert(/<html lang="es-DO">/.test(html),'La portada debe declarar es-DO');
  assert(/<title>Elite Scents RD \|/.test(html)&&/<h1><span class="h1-brand">Elite Scents RD/.test(html),'El título y el h1 deben llevar la marca');
  const metaDescription=html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert(metaDescription.startsWith('Elite Scents RD')&&metaDescription.length>=100&&metaDescription.length<=200,'La descripción debe empezar con la marca y tener una longitud útil');
  assert(html.includes('property="og:site_name" content="Elite Scents RD"'),'Debe declarar og:site_name');
  const sitemap=await readFile('sitemap.xml','utf8');
  const directory=renderDirectory(products);
  assert(directory.includes('<link rel="canonical" href="'+SITE_URL+'/perfumes/">')&&directory.includes('<meta name="robots" content="index,follow">')&&/<title>Todos los perfumes[^<]*\| Elite Scents RD<\/title>/.test(directory),'La lista completa es indexable, con título y canonical');
  assert(sitemap.includes('<loc>'+SITE_URL+'/perfumes/</loc>'),'El sitemap debe incluir la lista completa');
  assert(html.includes('href="/perfumes/"'),'La portada enlaza a la lista completa');
  const paths=new Set(), titles=new Set();
  for(const p of products){
    const path=productPath(p); assert(!paths.has(path),'Ruta de perfume repetida: '+path); paths.add(path);
    if(staticCards.some(c=>c.id===Number(p.id))) assert(html.includes('<a href="'+path+'">'),'La tarjeta de '+p.name+' debe enlazar a su página');
    assert(directory.includes('<a href="'+path+'">'),'La lista completa debe enlazar a '+p.name);
    assert(sitemap.includes('<loc>'+productUrl(p)+'</loc>'),'El sitemap debe incluir '+path);
    const page=renderProductPage(p,relatedOf(p));
    assert(page.includes('<link rel="canonical" href="'+productUrl(p)+'">'),'Canonical de '+path);
    assert(page.includes('<title>')&&page.includes('| Elite Scents RD</title>'),'Título con marca en '+path);
    assert(!page.includes('/pages/page-'),'Sin láminas en '+path);
    const lds=[...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
    const prod=lds.find(x=>x['@type']==='Product'), crumbs=lds.find(x=>x['@type']==='BreadcrumbList');
    assert(prod&&prod.name===p.name&&prod.offers.priceCurrency==='DOP'&&prod.offers.url===productUrl(p)&&prod.image&&prod.description.length>=120,'Product JSON-LD completo en '+path);
    assert(crumbs&&crumbs.itemListElement.length===3,'Migas de pan en '+path);
    assert(page.includes('<h1 class="detail-title">'+p.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')+'</h1>'),'h1 con el nombre en '+path);
    const title=page.match(/<title>([^<]*)<\/title>/)[1]; titles.add(title);
  }
  assert.equal(paths.size,N,'Debe haber una página de perfume distinta por producto');
  assert(titles.size>=N-5,'Los títulos de las páginas de perfume no deben repetirse');
  assert.equal((sitemap.match(/<image:image>/g)||[]).length,N,'El sitemap debe incluir la foto de cada perfume');
  for(const u of [SITE_URL+'/',SITE_URL+'/pedidos-envios.html',SITE_URL+'/privacidad.html']) assert(sitemap.includes('<loc>'+u+'</loc>'),'El sitemap debe incluir '+u);
  assert(!sitemap.includes('catalogo.html')&&!sitemap.includes('admin.html')&&!sitemap.includes('checkout.html'),'El sitemap no debe listar páginas retiradas ni privadas');
  // El slug de tienda.js (enlaces de las tarjetas dibujadas por JavaScript) debe ser idéntico al del build.
  const start=js.indexOf('function slugify(s)'),end=js.indexOf('\n',start);
  const clientSlug=new Function(js.slice(start,end)+'; return slugify;')();
  for(const p of products) assert.equal(clientSlug(p.name),slugify(p.name),'slugify de tienda.js debe coincidir para '+p.name);
  assert(js.includes('function productPath(p)')&&js.includes('function openFromHash()')&&js.includes("titleLink.href=productPath(p)"),'tienda.js debe enlazar a la página del perfume y abrir la ficha desde #producto-ID');
  const robots=await readFile('robots.txt','utf8'); assert(robots.includes('Sitemap: '+SITE_URL+'/sitemap.xml'),'robots.txt debe apuntar al sitemap');
  const artifactSource=await readFile('scripts/build-site-artifact.mjs','utf8'); assert(artifactSource.includes('renderProductPage')&&artifactSource.includes("'/perfumes'"),'El artefacto debe generar las páginas de perfume');
}
// --- Cookies en todas las páginas públicas ---
{
  const cookies=await readFile('cookies.js','utf8');
  for(const page of ['checkout.html','privacidad.html','pedidos-envios.html','404.html']) assert((await readFile(page,'utf8')).includes('<script src="/cookies.js"></script>'),'cookies.js debe cargarse en '+page);
  assert(template.includes('src="/cookies.js"'),'La portada debe cargar cookies.js');
  assert(cookies.includes('elite-cookie-consent-v1')&&cookies.includes('Solo necesarias')&&cookies.includes('Aceptar todas')&&cookies.includes('data-cookie-settings'),'El aviso debe ofrecer aceptar, solo necesarias y cambiar la elección');
  assert(css.includes('.cookie-banner')&&css.includes('.cookie-prefs'),'El CSS debe estilar el aviso de cookies');
  assert(privacy.includes('id="cookies"')&&privacy.includes('Preferencias de cookies'),'La política debe explicar las cookies');
  const artifact=await readFile('scripts/build-site-artifact.mjs','utf8'); assert(artifact.includes("'cookies.js'"),'cookies.js debe publicarse');
}
// --- Cuentas de clientes, recuperación y contraseñas ---
assert(customer.includes('function passwordProblems(')&&customer.includes('function collectOrigin()')&&customer.includes('data:{origen:collectOrigin()}'),'El registro debe validar la contraseña y enviar el origen');
assert(customer.includes('/auth/v1/recover?redirect_to=')&&customer.includes('verify_recovery_identity')&&customer.includes("scope=global"),'La recuperación debe usar enlace, verificación de identidad y cerrar sesiones');
assert(customer.includes('Si existe una cuenta con ese correo'),'La recuperación no debe revelar qué correos existen');
assert(checkout.includes('id="forgotLink"')&&checkout.includes('id="recoverForm"')&&checkout.includes('id="resetForm"')&&checkout.includes('id="resetMfaLabel"')&&checkout.includes('id="resetIdLabel"'),'checkout.html debe incluir la recuperación de contraseña');
{
  const start=customer.indexOf('const COMMON_PASSWORDS'),end=customer.indexOf('// Datos técnicos del registro');
  const passwordProblems=new Function(customer.slice(start,end)+'; return passwordProblems;')();
  assert.deepEqual(passwordProblems('Clave-Larga-2026','ana@example.com'),[],'Una contraseña fuerte debe aceptarse');
  assert(passwordProblems('corta1A','x@y.z').length>0,'Una contraseña corta debe rechazarse');
  assert(passwordProblems('todominuscula123','x@y.z').some(p=>/mayúscula/.test(p)),'Debe exigir mayúscula');
  assert(passwordProblems('TODOMAYUSCULA123','x@y.z').some(p=>/minúscula/.test(p)),'Debe exigir minúscula');
  assert(passwordProblems('SinNumerosAquiXY','x@y.z').some(p=>/número/.test(p)),'Debe exigir número');
  assert(passwordProblems('Gabriel2026Clave','gabriel@example.com').some(p=>/correo/.test(p)),'No debe contener la parte local del correo');
  assert(passwordProblems('Xpassword123Y','x@y.z').some(p=>/común/.test(p)),'Debe rechazar contraseñas comunes');
}
// --- Panel: MFA obligatorio, Cuentas Clientes y ofertas ---
assert(adminJs.includes('async function gate()')&&adminJs.includes("jwtAal(session.access_token) === 'aal2'")&&adminJs.includes('async function startMfaSetup()'),'El panel debe exigir MFA (código o activación)');
assert(adminHtml.includes('id="mfa-card"')&&adminHtml.includes('id="mfa-setup-card"')&&adminHtml.includes('id="mfa-qr"'),'admin.html debe incluir las pantallas de MFA');
assert(adminHtml.includes('Cuentas Clientes')&&adminHtml.includes('id="customers-body"')&&adminJs.includes('admin_list_customers'),'El panel debe listar las cuentas de clientes');
assert(adminHtml.includes('id="offer-form"')&&adminHtml.includes('name="offer_price"')&&adminHtml.includes('id="offer-remove-all"')&&adminJs.includes('function discountedAmounts('),'El panel debe permitir ofertas');
{
  const money=adminJs.slice(adminJs.indexOf('function money('),adminJs.indexOf('\n',adminJs.indexOf('function money(')));
  const block=adminJs.slice(adminJs.indexOf('const amountsOf'),adminJs.indexOf('const discountedText'));
  const {discountedAmounts}=new Function(money+'\n'+block+'; return {discountedAmounts};')();
  assert.deepEqual(discountedAmounts('RD$4,500',10),[4050],'10 % de 4,500');
  assert.deepEqual(discountedAmounts('RD$4,900',20),[3900],'20 % de 4,900 redondeado a 50');
  assert.deepEqual(discountedAmounts('RD$3,550 / RD$4,150',10),[3200,3750],'Cada presentación se descuenta por separado');
  assert.equal(discountedAmounts('RD$50',10),null,'Un precio demasiado bajo no admite oferta');
  assert.equal(discountedAmounts('Precio a confirmar',10),null,'Sin precio no hay oferta');
  for(const n of [100,850,2650,3150,10050]) for(const pct of [1,5,10,25,70]){const r=discountedAmounts('RD$'+n.toLocaleString('en-US'),pct); if(r) assert(r[0]<n&&r[0]>=50&&r[0]%50===0,'La oferta debe ser menor, múltiplo de 50 y >= 50: '+n+' '+pct)}
}
// Ofertas: mismos filtros que el catálogo (búsqueda, precio, marca, género, estado), Limpiar y paginación para los 420.
for(const id of ['offer-search','offer-price','offer-brand','offer-state','offer-clear','offer-more','offer-select-all','offer-deselect','offer-count']) assert(adminHtml.includes('id="'+id+'"'),'Las ofertas deben incluir '+id);
assert(['todos','hombre','mujer','unisex'].every(g=>adminHtml.includes('data-offer-gender="'+g+'"')),'Las ofertas deben filtrar por Todos/Hombre/Mujer/Unisex');
assert(!adminJs.includes('.slice(0, 80)'),'Las ofertas ya no deben limitarse a 80 perfumes');
{
  const money=adminJs.slice(adminJs.indexOf('function money('),adminJs.indexOf('\n',adminJs.indexOf('function money(')));
  const amounts=adminJs.slice(adminJs.indexOf('const amountsOf'),adminJs.indexOf('\n',adminJs.indexOf('const amountsOf')));
  const fn=adminJs.slice(adminJs.indexOf('function offerPriceMatches'),adminJs.indexOf('function offerCandidates'));
  const offerPriceMatches=new Function(money+'\n'+amounts+'\n'+fn+'; return offerPriceMatches;')();
  const cases=[['RD$2,850','under3000',true],['RD$3,000','under3000',false],['RD$3,000','3000-4999',true],['RD$4,900','3000-4999',true],['RD$5,000','3000-4999',false],['RD$5,000','5000-6999',true],['RD$7,000','5000-6999',false],['RD$7,000','7000plus',true],['RD$3,550 / RD$7,150','7000plus',true],['RD$3,550 / RD$4,150','under3000',false],['RD$4,000','all',true]];
  for(const [price,filter,expected] of cases) assert.equal(offerPriceMatches({price},filter),expected,'Filtro de precio '+filter+' con '+price);
  assert.equal(offerPriceMatches({price:'RD$2,000',original_price:'RD$3,500'},'under3000'),false,'El filtro de precio usa el precio normal, no el de oferta');
}
for(const f of ['20260921120000_cuentas_clientes.sql','20260921121000_ofertas.sql','20260921122000_recuperacion_identidad.sql']) assert(existsSync('supabase/migrations/'+f),'Falta la migración '+f);
{
  const [cuentas,ofertas,recuperacion,enforce]=await Promise.all(['supabase/migrations/20260921120000_cuentas_clientes.sql','supabase/migrations/20260921121000_ofertas.sql','supabase/migrations/20260921122000_recuperacion_identidad.sql','supabase/proposed/09_enforce_admin_mfa.sql'].map(f=>readFile(f,'utf8')));
  assert(cuentas.includes('create or replace function public.admin_list_customers()')&&cuentas.includes('private.is_store_admin()')&&/revoke all on function public\.admin_list_customers\(\) from public, anon/i.test(cuentas),'admin_list_customers debe ser solo para administradores');
  assert(!/encrypted_password|raw_app_meta_data/i.test(cuentas),'La vista de cuentas nunca debe exponer contraseñas');
  assert(ofertas.includes('original_price')&&ofertas.includes('products_offer_guard')&&ofertas.includes('expire_offers')&&ofertas.includes('cron.schedule'),'Las ofertas deben validarse y terminar solas');
  assert(recuperacion.includes("'locked'")&&recuperacion.includes("interval '30 minutes'")&&/grant execute on function public\.verify_recovery_identity\(text\) to authenticated/i.test(recuperacion)&&/revoke all on function public\.verify_recovery_identity\(text\) from public, anon/i.test(recuperacion),'La verificación de identidad debe limitar intentos y no ser pública');
  assert(enforce.includes("'aal2'")&&enforce.includes('private.is_store_admin()'),'La propuesta debe exigir AAL2 a administradores');
}
const lockMigration=await readFile('supabase/migrations/20260920120000_lock_down_place_customer_order.sql','utf8');
assert(/revoke execute on function public\.place_customer_order\(jsonb\) from public, anon/i.test(lockMigration)&&/grant\s+execute on function public\.place_customer_order\(jsonb\) to authenticated/i.test(lockMigration),'La migración versionada debe revocar anon y conceder authenticated');
assert(lockMigration.includes('to_regprocedure'),'La migración debe ser idempotente y no fallar si la función no existe');
assert(existsSync('supabase/verification/01_audit_queries.sql'),'Deben existir las consultas de auditoría de Supabase');
assert(!/insert\s+into|update\s+public|delete\s+from|drop\s+|alter\s+/i.test((await readFile('supabase/verification/01_audit_queries.sql','utf8')).replace(/--.*$/gm,'')),'Las consultas de auditoría deben ser de solo lectura');
const readme=await readFile('README.md','utf8');
assert(!/ozowziumk|service_role\s*=|\/admin\.html/i.test(readme),'El README público no debe exponer referencia de proyecto ni ruta del panel');
console.log('Pruebas de migración de fotos, privacidad y publicación superadas.');
