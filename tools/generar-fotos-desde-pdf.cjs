/* Herramienta OPCIONAL (no forma parte del sitio ni de la CI): genera las fotos individuales de img/productos/
 * a partir de las paginas del catalogo en PDF (una imagen JPEG por pagina), recortando solo la zona de la foto.
 *
 * Requisitos: Node 20+ y "npm install --no-save sharp" (dependencia solo de esta herramienta).
 * Uso (desde la raiz del repositorio):
 *   1. Extrae las paginas del PDF a una carpeta como page-01.jpg ... page-36.jpg (el PDF trae un JPEG por pagina).
 *   2. PAGES_DIR=<carpeta> OUT_DIR=<salida> node tools/generar-fotos-desde-pdf.cjs
 *   3. Revisa las hojas revision-lote-XX.jpg y copia los .jpg de cada carpeta lote-XX a img/productos/.
 * tools/fotos-overrides.json corrige a mano casos puntuales: { "ID": { "trimTop": px, "trimBottom": px } } (px de la pagina). */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const REPO = process.cwd();
const PAGES = process.env.PAGES_DIR || 'catalogo-pdf-paginas';
const OUT = process.env.OUT_DIR || 'fotos-generadas';
const cfg = fs.readFileSync(REPO + '/supabase-config.js', 'utf8');
const url = cfg.match(/url:\s*'([^']+)'/)[1], key = cfg.match(/publishableKey:\s*'([^']+)'/)[1];
const SIZE = 900, PAD = 50, QUALITY = 88;
const OV_FILE = process.env.OVERRIDES_FILE || 'tools/fotos-overrides.json';
const OVERRIDES = fs.existsSync(OV_FILE) ? JSON.parse(fs.readFileSync(OV_FILE, 'utf8')) : {};
const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

(async () => {
  const res = await fetch(url + '/rest/v1/products?select=id,name,page,slot&active=eq.true&order=id.asc&limit=1000', { headers: { apikey: key } });
  const products = await res.json();
  console.log('productos', products.length);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const pageCache = {};
  const manifest = [];
  const sizes = [34, 34, 34, 34, 34, 34, 36, 36, 36, 36, 36, 36];
  let cursor = 0;
  for (let b = 0; b < sizes.length; b++) {
    const batch = products.slice(cursor, cursor + sizes[b]); cursor += sizes[b];
    const dirName = 'lote-' + String(b + 1).padStart(2, '0');
    fs.mkdirSync(path.join(OUT, dirName), { recursive: true });
    const tiles = [];
    for (const p of batch) {
      if (process.env.ONLY && String(p.id) !== process.env.ONLY) continue;
      if (!Number.isInteger(p.page) || !Number.isInteger(p.slot)) { console.warn('sin page/slot', p.id, p.name); continue; }
      const pagePath = PAGES + '/page-' + String(p.page).padStart(2, '0') + '.jpg';
      if (!pageCache[p.page]) { const buf = await sharp(pagePath).png().toBuffer(); const meta = await sharp(buf).metadata(); pageCache[p.page] = { buf, w: meta.width, h: meta.height }; }
      const { buf, w, h } = pageCache[p.page];
      const cw = w / 3, ch = h / 4, col = p.slot % 3, row = Math.floor(p.slot / 3);
      const K = cw / 240; /* factor respecto al analisis original a 240 px por celda */
      const S = n => Math.max(1, Math.round(n * K));
      const left = Math.round(col * cw), top = Math.round(row * ch), width = Math.round(cw), winH = Math.round(ch * 0.8);
      const raw = await sharp(buf).extract({ left, top, width, height: winH }).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
      const px = raw.data, W = raw.info.width, H = raw.info.height, C = raw.info.channels;
      const nonwhite = (x, y) => { const o = (y * W + x) * C; return px[o] < 238 || px[o + 1] < 238 || px[o + 2] < 238; };
      const whiteRow = (y) => { for (let x = 0; x < W; x++) { const o = (y * W + x) * C; px[o] = px[o + 1] = px[o + 2] = 255; } };
      const rowCount = (y) => { let n = 0; for (let x = 0; x < W; x++) if (nonwhite(x, y)) n++; return n; };
      const counts = new Array(H).fill(0);
      for (let y = 0; y < H; y++) counts[y] = rowCount(y);
      const MINC = S(2);
      for (let y = 0; y < S(8); y++) if (counts[y] >= W * 0.8) { whiteRow(y); counts[y] = 0; }
      /* Agrupa filas con contenido; descarta fragmentos cortos (precio de la fila anterior) y toma la foto. */
      const clusters = []; { let cs = -1, blankRun = 0, last = -1;
        for (let y = 0; y < H; y++) {
          if (counts[y] >= MINC) { if (cs < 0) cs = y; last = y; blankRun = 0; }
          else if (cs >= 0) { blankRun++; if (blankRun >= S(3)) { clusters.push({ s: cs, e: last + 1 }); cs = -1; blankRun = 0; } }
        }
        if (cs >= 0) clusters.push({ s: cs, e: last + 1 }); }
      const big = clusters.filter(c => c.e - c.s >= S(24));
      let start = 0, end = -1;
      if (big.length) { start = big[0].s; end = big[0].e; }
      else if (clusters.length) { start = clusters[0].s; end = clusters[clusters.length - 1].e; }
      if (end < 0) end = Math.min(H, start + Math.round(ch * 0.62));
      /* 0) Fragmento del precio de la fila anterior pegado al borde superior. */
      for (let y = start + S(3); y < Math.min(start + S(16), end - S(60)); y++) {
        if (counts[y] <= S(3) && counts[y + 1] <= S(3)) { let z = y; while (z < end && counts[z] <= S(3)) z++; if (z - y >= S(2) && z < end - S(60)) { start = z; } break; }
      }
      /* 1) Quitar el rotulo del nombre si quedo pegado al final de la foto. */
      const lum = (o) => 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
      const isTextRow = (y) => {
        let runs = 0, inRun = false, dark = 0, nw = 0, sat = 0;
        for (let x = 0; x < W; x++) {
          const o = (y * W + x) * C;
          if (px[o] < 238 || px[o + 1] < 238 || px[o + 2] < 238) nw++;
          if (Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]) > 55) sat++;
          const d = lum(o) < 110; if (d) dark++;
          if (d && !inRun) { runs++; inRun = true; } else if (!d) inRun = false;
        }
        return runs >= 5 && sat <= S(3) && nw <= W * 0.85 && nw > 0 && dark / nw >= 0.4;
      };
      const isTextRow2 = (y) => { let runs = 0, inRun = false, dark = 0, nw = 0, sat = 0; for (let x = 0; x < W; x++) { const o = (y * W + x) * C; if (px[o] < 238 || px[o + 1] < 238 || px[o + 2] < 238) nw++; if (Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]) > 55) sat++; const d = lum(o) < 110; if (d) dark++; if (d && !inRun) { runs++; inRun = true; } else if (!d) inRun = false; } return runs >= 2 && nw <= W * 0.5 && sat <= S(3) && nw > 0 && dark / nw >= 0.6; };
      const textish = (y) => isTextRow(y) || isTextRow2(y);
      let cutTop = -1, bandBottom = -1;
      for (let y = end - 1; y >= Math.max(start + S(60), end - S(10)); y--) if (textish(y)) { bandBottom = y; break; }
      if (bandBottom >= 0) {
        let y = bandBottom, topRow = bandBottom, gap = 0, rows = 1;
        while (y > start + S(60) && bandBottom - y < S(46)) {
          y--;
          if (textish(y)) { topRow = y; rows++; gap = 0; } else { gap++; if (gap > S(9)) break; }
        }
        if (rows >= S(8) && bandBottom - topRow >= S(8) && topRow >= ch * 0.57) cutTop = topRow;
      }
      if (process.env.ONLY) { let s2=''; for (let y = end - 120; y < end; y++) s2 += isTextRow(y) ? 'T' : '.'; console.log('ROWS', s2); }
      if (process.env.ONLY) console.log('DBG', p.id, 'ch', Math.round(ch), 'K', K.toFixed(2), 'clusters', JSON.stringify(clusters), 'start', start, 'end', end, 'bandBottom', bandBottom, 'cutTop', cutTop);
      if (cutTop > 0) { end = Math.max(start + S(60), cutTop - S(4)); while (end > start + S(60) && counts[end - 1] <= 1) end--; }
      /* 2) Quitar astillas de fotos vecinas en los bordes laterales. */
      {
        const colCount = new Array(W).fill(0);
        for (let x = 0; x < W; x++) for (let y = start; y < end; y++) if (nonwhite(x, y)) colCount[x]++;
        const wipe = (x0, x1) => { for (let x = x0; x <= x1; x++) for (let y = 0; y < H; y++) { const o = (y * W + x) * C; px[o] = px[o + 1] = px[o + 2] = 255; } };
        let x = 0; while (x < W && colCount[x] < MINC) x++;
        const x0 = x; while (x < W && colCount[x] >= MINC) x++;
        let g = x; while (g < W && colCount[g] < MINC) g++;
        if (x - x0 > 0 && x - x0 <= S(10) && g - x >= S(4) && g < W) wipe(x0, x - 1);
        x = W - 1; while (x >= 0 && colCount[x] < MINC) x--;
        const x1 = x; while (x >= 0 && colCount[x] >= MINC) x--;
        g = x; while (g >= 0 && colCount[g] < MINC) g--;
        if (x1 - x > 0 && x1 - x <= S(10) && x - g >= S(4) && g >= 0) wipe(x + 1, x1);
      }
      const ov = OVERRIDES[String(p.id)] || {}; if (ov.trimTop) start = Math.max(start, ov.trimTop); if (ov.trimBottom) end = end - ov.trimBottom;
      const cropH = Math.max(20, end - start);
      const stage = await sharp(px, { raw: { width: W, height: H, channels: C } }).extract({ left: 0, top: start, width: W, height: Math.min(cropH, H - start) }).png().toBuffer();
      const img = await sharp(stage).trim({ background: '#ffffff', threshold: 30 }).png().toBuffer({ resolveWithObject: true }).catch(e => { console.warn(String(e.message)); return null; });
      if (!img) { console.warn('trim fallo', p.id, start, end, H); continue; }
      const inner = SIZE - PAD * 2;
      const out = await sharp(img.data).resize(inner, inner, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' })
        .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: '#ffffff' }).flatten({ background: '#ffffff' }).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
      const file = String(p.id).padStart(4, '0') + '-' + slug(p.name) + '.jpg';
      fs.writeFileSync(path.join(OUT, dirName, file), out);
      manifest.push({ id: p.id, name: p.name, batch: b + 1, file: dirName + '/' + file, source: 'PDF pagina ' + p.page + ' posicion ' + p.slot, dbg: { start, end, cutTop, slot: p.slot } });
      tiles.push({ id: p.id, name: p.name, out });
    }
    if (!tiles.length) continue;
    const cols = 6, cell = 260, rows = Math.ceil(tiles.length / cols);
    const comps = [];
    for (const [i, t] of tiles.entries()) {
      const thumb = await sharp(t.out).resize(cell - 20, cell - 50).toBuffer();
      const label = Buffer.from('<svg width="' + cell + '" height="30" xmlns="http://www.w3.org/2000/svg"><text x="4" y="20" font-size="14" font-family="Arial" fill="#111">' + String(t.id) + ' ' + t.name.slice(0, 30).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text></svg>');
      comps.push({ input: thumb, left: (i % cols) * cell + 10, top: Math.floor(i / cols) * cell + 4 });
      comps.push({ input: label, left: (i % cols) * cell, top: Math.floor(i / cols) * cell + cell - 44 });
    }
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#ffffff' } }).composite(comps).jpeg({ quality: 82 }).toFile(path.join(OUT, 'revision-' + dirName + '.jpg'));
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('fotos generadas', manifest.length);
})();
