// Prueba de extremo a extremo de Opaco en un navegador real (Chromium): acceso, análisis, revisión, descarga del PDF
// censurado y verificación de su contenido, créditos, aviso de créditos, mejora de plan simulada, cuenta y registro.
// Requiere playwright-core y Chromium:  PLAYWRIGHT_CORE=/ruta/playwright-core/index.mjs CHROMIUM=/ruta/chrome node scripts/test-opaco-e2e.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer } from './lib/static-server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const SHOTS = process.env.SHOTS || '';
const { server, url } = await startServer('.');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) problems.push(m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('dialog', d => d.accept());
const shot = async name => { if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' }); };
const credits = async () => Number((await page.textContent('.credit-pill strong')).split('/')[0].trim().replace('.', ''));
const step = msg => console.log('· ' + msg);

async function pdfText(bytes) {
  return page.evaluate(async b64 => {
    const pdfjs = await import('/opaco/vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = '/opaco/vendor/pdfjs/pdf.worker.min.js';
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) text += (await (await doc.getPage(p)).getTextContent()).items.map(i => i.str).join(' ') + '\n';
    const meta = await doc.getMetadata();
    return { text, pages: doc.numPages, info: meta.info };
  }, Buffer.from(bytes).toString('base64'));
}

async function analyzeSample(sample) {
  await page.click('[data-sample="' + sample + '"]');
  await page.waitForSelector('#stepConfirm:not([hidden])');
  await page.click('#analyze');
  await page.waitForSelector('#stepReview:not([hidden])', { timeout: 180000 });
  await page.waitForSelector('.page-wrap canvas');
}

async function download() {
  await page.click('#downloadOpen');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#exportGo')]);
  await page.waitForSelector('#exportResult:not([hidden]) .alert-ok');
  const bytes = await readFile(await dl.path());
  const verdict = await page.textContent('#exportResult');
  await page.click('#exportCancel');
  return { bytes, name: dl.suggestedFilename(), verdict };
}

// ---------------------------------------------------------------- portada y páginas públicas
await page.goto(url + '/opaco/');
assert.match(await page.title(), /Opaco/);
assert(await page.isVisible('#precios .plan.featured'), 'La portada muestra los precios');
assert.equal(await page.$$eval('#beforeAfter img', imgs => imgs.every(i => i.complete && i.naturalWidth > 0)), true, 'El antes/después carga sus imágenes');
for (const p of ['aviso-legal', 'privacidad', 'terminos', 'cookies']) { await page.goto(url + '/opaco/' + p + '.html'); assert(await page.isVisible('article.legal h1')); }
step('Portada y páginas legales');

// ---------------------------------------------------------------- acceso con la cuenta de prueba
await page.goto(url + '/opaco/app.html');
await page.waitForURL(/acceso\.html/);
await page.fill('#loginEmail', 'prueba@opaco.demo'); await page.fill('#loginPassword', 'contraseña-mala-1');
await page.click('#loginForm button[type=submit]');
await page.waitForSelector('#loginStatus.error');
await page.click('#fillDemo');
await page.click('#loginForm button[type=submit]');
await page.waitForURL(u => u.pathname.endsWith('/app.html'));
await page.waitForFunction(() => document.querySelector('[data-user=credits]').textContent !== '0');
assert.equal(await credits(), 5, 'La cuenta de prueba empieza con 5 créditos');
step('Acceso: contraseña incorrecta rechazada, cuenta de prueba con 5 créditos');

// ---------------------------------------------------------------- nómina: revisar, cambiar y descargar
await analyzeSample('nomina-ejemplo.pdf');
assert.equal(await credits(), 4, 'Analizar 1 página gasta 1 crédito');
const values = await page.$$eval('.item .value', n => n.map(x => x.firstChild.textContent));
for (const v of ['GARCÍA LÓPEZ, MARÍA', '45128763A', '688 123 456', 'maria.garcia.lopez@correo-ejemplo.es', 'Calle Ercilla 12, 2º D, 48009 Bilbao', 'ES14 2095 0611 0198 7654 3210', '48/10293847/21']) assert(values.includes(v), 'Detecta ' + v);
// Desactivar la dirección de la empresa (no es un dato personal), tapar "Kutxabank" y dibujar un recuadro sobre el CIF.
await page.locator('.item', { hasText: 'Gran Vía' }).locator('input[type=checkbox]').uncheck();
assert.equal(await page.locator('.box.off').count(), 1, 'El recuadro de la dirección de la empresa queda desactivado');
await page.fill('#addText', 'kutxabank'); await page.click('#addTextForm button');
await page.waitForSelector('#addStatus.ok');
await page.click('#drawMode');
const wrap = await page.locator('.page-wrap').first().boundingBox();
// El CIF está en la columna izquierda, hacia el 13 % de la altura de la página.
await page.mouse.move(wrap.x + wrap.width * 0.09, wrap.y + wrap.height * 0.122);
await page.mouse.down(); await page.mouse.move(wrap.x + wrap.width * 0.25, wrap.y + wrap.height * 0.139, { steps: 5 }); await page.mouse.up();
await page.click('#drawMode');
assert(await page.locator('.item', { hasText: 'B95123456' }).count(), 'El recuadro dibujado cubre el CIF');
await page.click('#peek');
await shot('01-revision-nomina');
await page.click('#peek');
const nomina = await download();
assert.equal(nomina.name, 'nomina-ejemplo-anonimizado.pdf');
assert.match(nomina.verdict, /verificado/i);
const out = await pdfText(nomina.bytes);
for (const secret of ['45128763', 'GARCÍA', 'LÓPEZ', 'ES14', '2095', 'maria.garcia', '688', 'Ercilla', '10293847', 'Kutxabank', 'B95123456']) assert(!out.text.includes(secret), 'El PDF censurado no debe contener «' + secret + '»');
for (const kept of ['RECIBO INDIVIDUAL', 'Salario base', 'Gran Vía']) assert(out.text.includes(kept), 'Se conserva como texto buscable: «' + kept + '»');
assert.equal(out.info.Title, 'Documento anonimizado'); assert(!out.info.Author, 'Sin autor en los metadatos');
assert.equal(await credits(), 4, 'Descargar no gasta créditos');
step('Nómina: 8 datos detectados, desactivar/añadir/dibujar, PDF descargado sin los datos y con el resto buscable');

// ---------------------------------------------------------------- contrato de 2 páginas, sin capa de texto
await page.click('#restart');
await analyzeSample('contrato-ejemplo.pdf');
assert.equal(await credits(), 2, 'El contrato de 2 páginas gasta 2 créditos');
const contrato = await page.$$eval('.item .value', n => n.map(x => x.firstChild.textContent));
for (const v of ['Juan Pérez Sánchez', 'Lucía Fernández Ortega', '21456789C', 'Y3456781X', '12/04/1971']) assert(contrato.includes(v), 'Detecta ' + v + ' en el contrato');
assert(await page.locator('.item', { hasText: 'Juan Pérez Sánchez' }).locator('.meta', { hasText: 'págs. 1, 2' }).count(), 'Agrupa las apariciones de las dos páginas');
await page.click('#downloadOpen'); await page.uncheck('#keepText'); await page.click('#exportCancel');
const c = await download();
const ctext = await pdfText(c.bytes);
assert.equal(ctext.pages, 2); assert.equal(ctext.text.trim(), '', 'Sin capa de texto no queda ningún texto en el PDF');
step('Contrato: 2 créditos, nombres agrupados entre páginas, PDF sin ningún texto');

// ---------------------------------------------------------------- factura escaneada (OCR) y aviso de pocos créditos
await page.click('#restart');
await analyzeSample('factura-escaneada-ejemplo.pdf');
assert.equal(await credits(), 1);
const ocr = await page.$$eval('.item .value', n => n.map(x => x.firstChild.textContent));
assert(ocr.includes('53987214G'), 'El OCR permite detectar el DNI de la factura escaneada: ' + ocr.join(' | '));
assert(ocr.some(v => /ES70/.test(v)), 'Y el IBAN del cliente');
assert(ocr.some(v => /alejandro\.martin/.test(v)), 'Y su correo, aunque el OCR lea mal la arroba');
assert(ocr.some(v => /Ayuntamiento 9/.test(v)), 'Y su dirección');
assert(await page.isVisible('#alerts .alert-warn'), 'Aviso de que quedan pocos créditos');
await shot('02-factura-escaneada');
step('Factura escaneada: OCR ' + ocr.length + ' datos · aviso de pocos créditos');

// ---------------------------------------------------------------- sin créditos y mejora de plan simulada
await page.click('#restart');
await analyzeSample('nomina-ejemplo.pdf');
assert.equal(await credits(), 0);
assert(await page.isVisible('#alerts .alert-danger'), 'Aviso de que no quedan créditos');
await page.click('#restart');
await page.click('[data-sample="contrato-ejemplo.pdf"]');
await page.waitForSelector('#confirmAlert .alert-danger');
assert(await page.isDisabled('#analyze'), 'Sin créditos no se puede analizar');
await shot('03-sin-creditos');
await page.click('#confirmAlert a');
await page.waitForURL(/pago\.html\?plan=profesional/);
assert(await page.isVisible('.stamp'), 'El pago simulado está señalizado');
await shot('04-pago-simulado');
await page.click('#payButton');
await page.waitForURL(/cuenta\.html\?pago=ok/);
await page.waitForFunction(() => document.querySelector('[data-user=credits]').textContent === '200');
assert.match(await page.textContent('#invoices'), /19/);
assert.match(await page.textContent('#usage'), /Mejora al plan Profesional/);
await shot('05-cuenta');
step('Sin créditos → mejora a Profesional (simulada) → 200 créditos y factura simulada');

// ---------------------------------------------------------------- cancelar, renovar y restablecer
await page.click('text=Cancelar suscripción');
await page.waitForSelector('#planStatus.ok');
await page.click('#simulateRenewal');
await page.waitForSelector('#demoStatus.ok');
assert.equal(await page.textContent('#planBadge'), 'Gratuito', 'Tras cancelar y llegar a fin de mes se pasa al plan Gratuito');
await page.goto(url + '/opaco/pago.html?plan=empresa');
await page.click('#payButton');
await page.waitForURL(u => u.pathname.endsWith('/cuenta.html'));
await page.waitForFunction(() => document.querySelector('[data-user=credits]').textContent === '1.000');
await page.click('#simulateRenewal'); await page.waitForSelector('#demoStatus.ok');
assert.equal(await page.$$eval('#invoices tr', r => r.length), 3, 'Alta Profesional + alta Empresa + renovación');
await page.click('#resetDemo'); await page.waitForSelector('#demoStatus.ok');
await page.waitForFunction(() => document.querySelector('[data-user=credits]').textContent === '5');
step('Cancelación, renovación mensual simulada, plan Empresa y restablecer la cuenta de prueba');

// ---------------------------------------------------------------- registro de una cuenta nueva
await page.click('#menuButton'); await page.click('[data-action=logout]');
await page.waitForURL(/acceso\.html/);
await page.click('#tabRegister');
await page.fill('#regName', 'Laura Gestora'); await page.fill('#regEmail', 'laura@gestoria.test'); await page.fill('#regPassword', 'corta');
await page.check('#regAccept'); await page.click('#registerForm button[type=submit]');
await page.waitForSelector('#registerStatus.error');
await page.fill('#regPassword', 'unaClaveSegura2026'); await page.click('#registerForm button[type=submit]');
await page.waitForURL(u => u.pathname.endsWith('/app.html'));
await page.waitForFunction(() => document.querySelector('[data-user=credits]').textContent === '5');
assert.equal(await page.textContent('#menuButton [data-user=name]'), 'Laura Gestora');
step('Registro: contraseña débil rechazada, cuenta nueva con 5 créditos');

// ---------------------------------------------------------------- móvil
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(url + '/opaco/');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Sin desplazamiento horizontal en móvil');
await shot('06-movil');

assert.deepEqual(problems, [], 'Errores en la consola del navegador:\n' + problems.join('\n'));
console.log('Prueba de extremo a extremo de Opaco superada.');
await browser.close(); server.close();
