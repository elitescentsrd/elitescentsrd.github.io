// Reconocimiento de texto (OCR) para páginas escaneadas, con Tesseract en el propio navegador.
// El motor y el modelo de español se sirven desde esta misma web (vendor/tesseract): la imagen no sale del equipo.
let workerPromise = null;

export function ocrWorker(onProgress = () => {}) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
      const base = new URL('../vendor/tesseract/', import.meta.url).href;
      return createWorker('spa', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        workerBlobURL: false,
        gzip: false,
        cacheMethod: 'none',
        logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); },
      });
    })().catch(err => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

// Devuelve las líneas reconocidas con sus palabras y cajas (en píxeles del lienzo recibido).
export async function recognize(canvas, onProgress) {
  const worker = await ocrWorker(onProgress);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const lines = [];
  for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) {
    const words = (line.words || []).filter(w => w.text && w.text.trim() && w.confidence > 10).map(w => ({ text: w.text, bbox: w.bbox }));
    if (words.length) lines.push({ words });
  }
  return lines;
}

export async function terminateOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  if (w) await w.terminate();
}
