// Genera el PDF censurado y comprueba que lo tapado no se puede recuperar.
//
// Cómo se censura "de verdad": cada página se dibuja como imagen con los recuadros negros ya pintados encima y se
// monta un PDF nuevo solo con esas imágenes. En el archivo final no queda el texto original, ni capas, ni metadatos,
// ni formularios, ni adjuntos: debajo de un recuadro no hay nada que copiar.
// Opcionalmente se añade una capa de texto invisible SOLO con el texto que no toca ningún recuadro, para que el
// documento se pueda seguir buscando y copiando. Después se vuelve a abrir el PDF generado y se verifica que ninguno de
// los datos censurados aparece en él.
import { PDFDocument, StandardFonts, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, setCharacterSqueeze, showText, pushGraphicsState, popGraphicsState } from '../vendor/pdf-lib.esm.min.js';
import { segmentBox, intersects } from './pagetext.js';
import { fold } from './detector.js';

function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? b.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject) : reject(new Error('No se pudo generar la imagen de la página.')), type, quality));
}

// Dibuja una página del PDF original en un lienzo, con los recuadros activos pintados en negro opaco.
export async function renderRedactedPage(pdfjs, pdfPage, rects, scale) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  ctx.fillStyle = '#000';
  for (const r of rects) ctx.fillRect(Math.floor(r.x * scale), Math.floor(r.y * scale), Math.ceil(r.w * scale) + 1, Math.ceil(r.h * scale) + 1);
  return canvas;
}

export async function exportRedacted({ pdfjs, pdf, pages, detections, dpi = 200, keepText = true, onProgress = () => {} }) {
  const out = await PDFDocument.create({ updateMetadata: false });
  const font = keepText ? await out.embedFont(StandardFonts.Helvetica) : null;
  const scale = dpi / 72;
  const encodable = new Map();
  const canEncode = ch => {
    if (!encodable.has(ch)) { try { font.encodeText(ch); encodable.set(ch, true); } catch { encodable.set(ch, false); } }
    return encodable.get(ch);
  };

  for (let p = 0; p < pdf.numPages; p++) {
    onProgress(p, pdf.numPages);
    const pdfPage = await pdf.getPage(p + 1);
    const vp1 = pdfPage.getViewport({ scale: 1 });
    const rects = detections.filter(d => d.active && d.page === p).flatMap(d => d.rects);
    const canvas = await renderRedactedPage(pdfjs, pdfPage, rects, scale);
    const jpg = await out.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.9));
    canvas.width = canvas.height = 0; // libera memoria
    const W = vp1.width, H = vp1.height;
    const page = out.addPage([W, H]);
    page.drawImage(jpg, { x: 0, y: 0, width: W, height: H });

    if (keepText && pages[p]) {
      const fontKey = page.node.newFontDictionary(font.name, font.ref);
      const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
      let any = false;
      for (const seg of pages[p].segs) {
        const str = seg.str.replace(/\s+/g, ' ');
        if (!str.trim() || seg.whole) continue;
        const box = segmentBox(seg);
        // Cualquier trozo de texto que roce un recuadro activo se descarta entero: nunca se conserva texto tapado.
        if (rects.some(r => intersects(box, r, 1))) continue;
        const clean = [...str].map(ch => canEncode(ch) ? ch : '?').join('');
        const size = Math.max(1, seg.h);
        const natural = font.widthOfTextAtSize(clean, size);
        if (!natural || !seg.W) continue;
        const dx = seg.ux, dy = -seg.uy; // dirección del texto en coordenadas PDF (y hacia arriba)
        ops.push(setFontAndSize(fontKey, size), setCharacterSqueeze(Math.max(1, Math.min(1000, (seg.W / natural) * 100))),
          setTextMatrix(dx, dy, -dy, dx, seg.ox, H - seg.oy), showText(font.encodeText(clean)));
        any = true;
      }
      ops.push(endText(), popGraphicsState());
      if (any) page.pushOperators(...ops);
    }
  }
  const now = new Date();
  out.setTitle('Documento anonimizado'); out.setProducer('Opaco'); out.setCreator('Opaco');
  out.setAuthor(''); out.setSubject(''); out.setKeywords([]);
  out.setCreationDate(now); out.setModificationDate(now);
  onProgress(pdf.numPages, pdf.numPages);
  const bytes = await out.save({ useObjectStreams: true });
  return bytes;
}

// Abre el PDF generado y busca en su texto cada dato censurado. Devuelve los que se pudieran recuperar (debería ser ninguno).
export async function verifyRedaction(pdfjs, bytes, detections) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  const pageTexts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pageTexts.push(fold(tc.items.map(i => i.str || '').join('')).replace(/[\s ]+/g, ''));
  }
  const info = await doc.getMetadata().catch(() => ({}));
  const meta = fold(JSON.stringify(info.info || {}) + (info.metadata ? JSON.stringify([...info.metadata]) : '')).replace(/\s+/g, '');
  const pages = doc.numPages;
  await doc.destroy();
  const all = pageTexts.join('');
  const kept = new Set(detections.filter(d => !d.active && d.text).map(d => fold(d.text).replace(/\s+/g, '')));
  const checked = new Set(), leaks = [];
  for (const d of detections) {
    if (!d.active || !d.text || d.source === 'draw') continue;
    const needle = fold(d.text).replace(/\s+/g, '');
    if (needle.length < 3 || kept.has(needle) || checked.has(needle)) continue;
    checked.add(needle);
    if (all.includes(needle) || meta.includes(needle)) leaks.push(d.text);
  }
  return { checked: checked.size, leaks, pages };
}
