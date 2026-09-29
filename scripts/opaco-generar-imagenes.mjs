// Genera, con un navegador real y el propio código de Opaco:
//  - opaco/ejemplos/factura-escaneada-ejemplo.pdf: la factura de ejemplo convertida en imagen (como un escaneo),
//    para probar el reconocimiento de texto (OCR);
//  - opaco/img/antes.png y opaco/img/despues.png: la comparación "antes / después" de la portada.
// Requiere playwright-core y Chromium:  PLAYWRIGHT_CORE=/ruta/playwright-core/index.mjs CHROMIUM=/ruta/chrome node scripts/opaco-generar-imagenes.mjs
import { writeFile } from 'node:fs/promises';
import { startServer } from './lib/static-server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const { server, url } = await startServer('.');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();
await page.goto(url + '/opaco/aviso-legal.html'); // cualquier página del sitio: da el origen para importar los módulos

const out = await page.evaluate(async () => {
  const pdfjs = await import('/opaco/vendor/pdfjs/pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = '/opaco/vendor/pdfjs/pdf.worker.min.js';
  const { PDFDocument } = await import('/opaco/vendor/pdf-lib.esm.min.js');
  const { segmentsFromTextContent, buildPage, boxesFor } = await import('/opaco/js/pagetext.js');
  const { detectDocument } = await import('/opaco/js/detector.js');
  const { renderRedactedPage } = await import('/opaco/js/redactor.js');
  const load = async name => pdfjs.getDocument({ data: new Uint8Array(await (await fetch('/opaco/ejemplos/' + name)).arrayBuffer()), isEvalSupported: false, standardFontDataUrl: '/opaco/vendor/pdfjs/standard_fonts/' }).promise;
  const toBase64 = async blob => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

  // Factura "escaneada": gris, un poco de ruido y un leve giro, como sale de un escáner de oficina.
  const factura = await load('factura-ejemplo.pdf');
  const fp = await factura.getPage(1);
  const v = fp.getViewport({ scale: 200 / 72 });
  const src = document.createElement('canvas'); src.width = v.width; src.height = v.height;
  const sctx = src.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, src.width, src.height);
  await fp.render({ canvasContext: sctx, viewport: v }).promise;
  const scan = document.createElement('canvas'); scan.width = src.width; scan.height = src.height;
  const c = scan.getContext('2d'); c.fillStyle = '#f7f6f2'; c.fillRect(0, 0, scan.width, scan.height);
  c.translate(scan.width / 2, scan.height / 2); c.rotate(0.35 * Math.PI / 180); c.translate(-scan.width / 2, -scan.height / 2);
  c.filter = 'grayscale(1) contrast(1.05) blur(0.35px)'; c.drawImage(src, 0, 0); c.filter = 'none'; c.setTransform(1, 0, 0, 1, 0, 0);
  const img = c.getImageData(0, 0, scan.width, scan.height); let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) { seed = (seed * 16807) % 2147483647; const n = (seed / 2147483647 - 0.5) * 18; for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + n)); }
  c.putImageData(img, 0, 0);
  const jpg = await new Promise(r => scan.toBlob(r, 'image/jpeg', 0.82));
  const doc = await PDFDocument.create();
  doc.setTitle('Factura escaneada (ejemplo ficticio)'); doc.setCreator('Opaco'); doc.setProducer('Opaco');
  const pv = fp.getViewport({ scale: 1 });
  const pg = doc.addPage([pv.width, pv.height]);
  pg.drawImage(await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer())), { x: 0, y: 0, width: pv.width, height: pv.height });
  const scanned = await doc.save();

  // Antes / después de la nómina (parte superior de la página).
  const nomina = await load('nomina-ejemplo.pdf');
  const np = await nomina.getPage(1);
  const vp1 = np.getViewport({ scale: 1 });
  const model = buildPage(segmentsFromTextContent(await np.getTextContent(), vp1, pdfjs.Util.transform));
  const [found] = detectDocument([model.text]);
  const rects = found.flatMap(d => boxesFor(model, d.start, d.end));
  const scale = 1200 / (vp1.width * 0.86);
  const crop = async list => {
    const full = await renderRedactedPage(pdfjs, np, list, scale);
    const cut = document.createElement('canvas'); cut.width = 1200; cut.height = 1080;
    const x0 = vp1.width * 0.07 * scale, y0 = vp1.height * 0.02 * scale;
    cut.getContext('2d').drawImage(full, x0, y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
    return toBase64(await new Promise(r => cut.toBlob(r, 'image/png')));
  };
  return { scanned: await toBase64(new Blob([scanned])), antes: await crop([]), despues: await crop(rects), found: found.length };
});

await writeFile('opaco/ejemplos/factura-escaneada-ejemplo.pdf', Buffer.from(out.scanned, 'base64'));
await writeFile('opaco/img/antes.png', Buffer.from(out.antes, 'base64'));
await writeFile('opaco/img/despues.png', Buffer.from(out.despues, 'base64'));
console.log('Generados: factura escaneada, antes.png y despues.png (' + out.found + ' datos tapados en la nómina).');
await browser.close(); server.close();
