// Convierte el texto de una página (de pdf.js o del OCR) en una sola cadena para el detector y guarda, para cada carácter,
// de qué trozo de texto viene. Así cualquier detección (posiciones en la cadena) se traduce en recuadros sobre la página.
// Todas las coordenadas son de la página a escala 1 (puntos PDF, origen arriba a la izquierda, ya con la rotación aplicada).

// Segmento: { str, ox, oy (inicio de la línea base), ux, uy (dirección del texto), W (ancho), asc, desc, font, prop }
export function segmentsFromTextContent(content, viewport, multiply) {
  const segs = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    const tx = multiply(viewport.transform, item.transform);
    const h = Math.hypot(tx[2], tx[3]);
    const len = Math.hypot(tx[0], tx[1]) || 1;
    const ux = tx[0] / len, uy = tx[1] / len;
    const style = content.styles[item.fontName] || {};
    const asc = style.ascent ? style.ascent * h : 0.8 * h;
    const desc = style.descent ? Math.abs(style.descent) * h : 0.22 * h;
    const W = (item.width || 0) * viewport.scale;
    // Las mayúsculas acentuadas (Á, Í...) sobresalen por encima de la altura normal: el margen superior lo tiene en cuenta.
    segs.push({ str: item.str, ox: tx[4], oy: tx[5], ux, uy, W, h, asc: Math.max(asc, 0.95 * h), desc: Math.max(desc, 0.25 * h), font: style.fontFamily || 'sans-serif', eol: !!item.hasEOL });
  }
  return segs;
}

// Palabras del OCR (cajas en píxeles del lienzo renderizado a "scale").
export function segmentsFromOcr(lines, scale) {
  const segs = [];
  for (const line of lines) {
    line.words.forEach((w, i) => {
      const { x0, y0, x1, y1 } = w.bbox;
      segs.push({ str: w.text, ox: x0 / scale, oy: y1 / scale, ux: 1, uy: 0, W: (x1 - x0) / scale, h: (y1 - y0) / scale, asc: (y1 - y0) / scale, desc: 0, font: 'sans-serif', prop: true, eol: i === line.words.length - 1 });
    });
  }
  return segs;
}

// Campos de formulario rellenados (su texto no sale en el contenido normal de la página).
export function segmentsFromAnnotations(annotations, viewport) {
  const segs = [];
  for (const a of annotations) {
    const value = typeof a.fieldValue === 'string' ? a.fieldValue : Array.isArray(a.fieldValue) ? a.fieldValue.join(', ') : '';
    if (a.subtype !== 'Widget' || !value.trim() || !a.rect) continue;
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
    const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    segs.push({ str: value.replace(/\s+/g, ' '), ox: left, oy: bottom, ux: 1, uy: 0, W: right - left, h: bottom - top, asc: bottom - top, desc: 0, font: 'sans-serif', prop: true, whole: true, eol: true });
  }
  return segs;
}

export function buildPage(segs) {
  let text = '';
  const segOf = [], idxOf = [];
  const add = (ch, s, i) => { text += ch; segOf.push(s); idxOf.push(i); };
  segs.forEach((seg, s) => {
    if (s > 0) {
      const prev = segs[s - 1];
      const sep = separator(prev, seg);
      if (sep && !(sep === ' ' && (/\s$/.test(text) || /^\s/.test(seg.str))) && !(sep === '\n' && /\n$/.test(text))) add(sep, -1, -1);
    }
    for (let i = 0; i < seg.str.length; i++) add(seg.str[i], s, i);
  });
  return { text, segs, segOf, idxOf };
}

function separator(a, b) {
  if (!b.str && !a.str) return '';
  if (a.eol && !a.prop) return '\n';
  const h = Math.max(a.h, b.h, 1);
  // Distancia de b al renglón de a, medida perpendicular al texto.
  const dx = b.ox - a.ox, dy = b.oy - a.oy;
  const across = Math.abs(-a.uy * dx + a.ux * dy);
  if (across > 0.5 * h) return '\n';
  const along = (b.ox - (a.ox + a.ux * a.W)) * a.ux + (b.oy - (a.oy + a.uy * a.W)) * a.uy;
  if (along < -0.5 * h) return '\n';
  if (a.prop && b.prop) return a.eol ? '\n' : ' ';
  return along > 0.15 * h ? ' ' : '';
}

let measureCtx = null;
function fraction(seg, i) {
  if (i <= 0) return 0;
  if (i >= seg.str.length) return 1;
  if (!seg.prop && typeof OffscreenCanvas !== 'undefined') {
    measureCtx = measureCtx || new OffscreenCanvas(8, 8).getContext('2d');
    measureCtx.font = '100px ' + seg.font;
    const full = measureCtx.measureText(seg.str).width;
    if (full > 0) return measureCtx.measureText(seg.str.slice(0, i)).width / full;
  }
  return i / seg.str.length;
}

// Recuadros (x, y, w, h) que cubren los caracteres [start, end) de la página. Se amplían un poco para tapar con margen.
export function boxesFor(page, start, end) {
  const bySeg = new Map();
  for (let c = start; c < end; c++) {
    const s = page.segOf[c];
    if (s < 0) continue;
    const r = bySeg.get(s) || [Infinity, -Infinity];
    r[0] = Math.min(r[0], page.idxOf[c]); r[1] = Math.max(r[1], page.idxOf[c] + 1);
    bySeg.set(s, r);
  }
  const boxes = [];
  for (const [s, [i0, i1]] of bySeg) {
    const seg = page.segs[s];
    const f0 = seg.whole ? 0 : fraction(seg, i0), f1 = seg.whole ? 1 : fraction(seg, i1);
    const padX = 0.12 * seg.h, padY = 0.1 * seg.h;
    const a0 = f0 * seg.W - padX, a1 = f1 * seg.W + padX;
    const nx = seg.uy, ny = -seg.ux; // normal hacia "arriba" del texto (en coordenadas con y hacia abajo)
    const pts = [];
    for (const a of [a0, a1]) for (const n of [seg.asc + padY, -(seg.desc + padY)]) pts.push([seg.ox + seg.ux * a + nx * n, seg.oy + seg.uy * a + ny * n]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    boxes.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  }
  return mergeLine(boxes);
}

// Une recuadros contiguos del mismo renglón (un nombre partido en varios trozos de texto queda como un solo recuadro).
function mergeLine(boxes) {
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const b of boxes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - b.y) < 0.4 * b.h && Math.abs(last.h - b.h) < 0.5 * b.h && b.x <= last.x + last.w + 0.6 * b.h) {
      const x2 = Math.max(last.x + last.w, b.x + b.w), y2 = Math.max(last.y + last.h, b.y + b.h);
      last.x = Math.min(last.x, b.x); last.y = Math.min(last.y, b.y); last.w = x2 - last.x; last.h = y2 - last.y;
    } else out.push({ ...b });
  }
  return out;
}

// Rectángulo de cada segmento completo (para decidir qué texto invisible puede conservarse en el PDF final).
export function segmentBox(seg) {
  const nx = seg.uy, ny = -seg.ux;
  const pts = [];
  for (const a of [0, seg.W]) for (const n of [seg.asc, -seg.desc]) pts.push([seg.ox + seg.ux * a + nx * n, seg.oy + seg.uy * a + ny * n]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const intersects = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
