// Herramienta de anonimización: subir, analizar (gasta créditos), revisar y descargar el PDF censurado.
// El documento nunca sale del navegador: pdf.js lo lee, el detector y el OCR trabajan aquí y el PDF final se genera aquí.
import * as pdfjs from '../vendor/pdfjs/pdf.min.js';
import { me, consume, refund } from './api.js';
import { $, $$, el, requireUser, paintUser, creditAlert, plural, onAccountChange, toast } from './common.js';
import { detectDocument, findAll, CATEGORIES, fold } from './detector.js';
import { segmentsFromTextContent, segmentsFromAnnotations, segmentsFromOcr, buildPage, boxesFor, segmentBox, intersects } from './pagetext.js';
import { exportRedacted, verifyRedaction } from './redactor.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
const DOC_OPTIONS = {
  isEvalSupported: false,
  cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
};
const MAX_BYTES = 60 * 1024 * 1024, MAX_PAGES = 200;
const ORDER = ['nombre', 'dni', 'telefono', 'email', 'direccion', 'cuenta', 'nacimiento', 'nss', 'manual'];

let user = await requireUser();
const S = { file: null, bytes: null, pdf: null, pages: [], sizes: [], detections: [], downloaded: false, zoom: 1, rendered: new Map() };
let seq = 0;
const nextId = () => 'd' + (++seq);

// ---------------------------------------------------------------- cabecera y avisos de créditos
function paintCredits() {
  paintUser(user);
  const box = $('#alerts'); box.replaceChildren();
  const a = creditAlert(user); if (a) box.append(a);
}
onAccountChange(async () => { const u = await me(); if (!u) { location.replace('acceso.html'); return; } user = u; paintCredits(); if (!$('#stepConfirm').hidden) showConfirm(); });
paintCredits();

function show(step) { for (const id of ['stepUpload', 'stepConfirm', 'stepProgress', 'stepReview']) $('#' + id).hidden = id !== step; }

// ---------------------------------------------------------------- 1. subir
const input = $('#fileInput'), drop = $('#dropzone');
input.addEventListener('change', () => { if (input.files[0]) openFile(input.files[0]); input.value = ''; });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
$$('[data-sample]').forEach(b => b.addEventListener('click', async () => {
  b.disabled = true;
  try {
    const res = await fetch('ejemplos/' + b.dataset.sample);
    if (!res.ok) throw new Error('No se pudo cargar el ejemplo.');
    await openFile(new File([await res.blob()], b.dataset.sample, { type: 'application/pdf' }));
  } catch (err) { toast(err.message); } finally { b.disabled = false; }
}));

async function openFile(file) {
  if (file.size > MAX_BYTES) { toast('El archivo supera los 60 MB.'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 1024)).indexOf('%PDF') < 0) { toast('Ese archivo no es un PDF.'); return; }
  await closeDoc();
  const task = pdfjs.getDocument({ ...DOC_OPTIONS, data: bytes.slice() });
  task.onPassword = (update, reason) => {
    const pw = prompt(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'Contraseña incorrecta. Vuelve a intentarlo:' : 'Este PDF está protegido con contraseña. Escríbela para abrirlo:');
    if (pw === null) task.destroy(); else update(pw);
  };
  try { S.pdf = await task.promise; }
  catch (err) { toast(/password|Contraseña/i.test(err.message) || err.name === 'PasswordException' ? 'No se ha podido abrir el PDF sin su contraseña.' : 'No se ha podido leer el PDF: puede estar dañado.'); return; }
  if (S.pdf.numPages > MAX_PAGES) { toast('El documento tiene ' + S.pdf.numPages + ' páginas; el máximo es ' + MAX_PAGES + '. Divídelo en partes.'); await closeDoc(); return; }
  S.file = file; S.bytes = bytes; S.downloaded = false;
  showConfirm();
}

async function closeDoc() {
  const old = S.pdf;
  S.pdf = null;
  if (old) await old.destroy().catch(() => {});
  Object.assign(S, { file: null, bytes: null, pdf: null, pages: [], sizes: [], detections: [], downloaded: false, zoom: 1 });
  S.rendered = new Map();
  $('#pages').replaceChildren();
}

// ---------------------------------------------------------------- 2. confirmar el gasto de créditos
function showConfirm() {
  if (!S.pdf) return;
  const n = S.pdf.numPages;
  $('#fileName').textContent = S.file.name;
  $('#fileInfo').textContent = plural(n, 'página', 'páginas') + ' · ' + (S.file.size / 1024 < 1024 ? Math.max(1, Math.round(S.file.size / 1024)) + ' KB' : (S.file.size / 1048576).toFixed(1).replace('.', ',') + ' MB') + ' · consumirá ' + plural(n, 'crédito', 'créditos') + ' (te quedan ' + user.credits + ')';
  const box = $('#confirmAlert'); box.replaceChildren();
  const enough = user.credits >= n;
  $('#analyze').disabled = !enough;
  $('#analyze').textContent = 'Analizar (' + plural(n, 'crédito', 'créditos') + ')';
  if (!enough) {
    $('#alerts').replaceChildren(); // el aviso de aquí abajo ya lo dice, con el detalle de este documento
    box.append(el('div', { class: 'alert alert-danger', role: 'alert' },
      el('p', {}, el('strong', {}, user.credits ? 'No tienes créditos suficientes. ' : 'Te has quedado sin créditos. '), 'Este documento necesita ' + plural(n, 'crédito', 'créditos') + ' y te ' + (user.credits === 1 ? 'queda ' : 'quedan ') + user.credits + '.'),
      el('a', { class: 'btn btn-primary btn-sm', href: 'pago.html?plan=' + (user.plan === 'empresa' ? 'empresa' : user.plan === 'gratis' ? 'profesional' : 'empresa') }, 'Mejorar plan')));
  }
  show('stepConfirm');
  $('#analyze').focus();
}
$('#changeFile').addEventListener('click', async () => { await closeDoc(); show('stepUpload'); });

// ---------------------------------------------------------------- 3. analizar
function progress(title, done, total, text) {
  $('#progressTitle').textContent = title;
  $('#progressBar').style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
  $('#progressText').textContent = text || '';
}

$('#analyze').addEventListener('click', async () => {
  const n = S.pdf.numPages;
  let movement;
  try { const r = await consume(n); movement = r.movement; user = r.user; paintCredits(); }
  catch (err) { toast(err.message); user = (await me()) || user; showConfirm(); return; }
  show('stepProgress');
  try {
    let ocrUsed = 0;
    for (let p = 0; p < n; p++) {
      progress('Analizando el documento…', p, n, 'Leyendo la página ' + (p + 1) + ' de ' + n + '…');
      const page = await S.pdf.getPage(p + 1);
      const vp = page.getViewport({ scale: 1 });
      S.sizes[p] = { w: vp.width, h: vp.height };
      const content = await page.getTextContent();
      let segs = segmentsFromTextContent(content, vp, pdfjs.Util.transform);
      const visible = segs.map(s => s.str).join('').replace(/\s/g, '').length;
      if (visible < 25) {
        // Página sin texto (escaneada o foto): se reconoce el texto de la imagen.
        ocrUsed++;
        progress('Reconociendo el texto de una página escaneada…', p, n, 'Página ' + (p + 1) + ' de ' + n + (ocrUsed === 1 ? ' · la primera vez se prepara el reconocimiento de texto en tu navegador' : ''));
        const { recognize } = await import('./ocr.js');
        const scale = Math.min(300 / 72, 4200 / Math.max(vp.width, vp.height));
        const canvas = document.createElement('canvas');
        const v = page.getViewport({ scale });
        canvas.width = Math.ceil(v.width); canvas.height = Math.ceil(v.height);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: v }).promise;
        const lines = await recognize(canvas, pr => progress('Reconociendo el texto de una página escaneada…', p + pr, n, 'Página ' + (p + 1) + ' de ' + n + ' · ' + Math.round(pr * 100) + ' %'));
        canvas.width = canvas.height = 0;
        segs = segs.concat(segmentsFromOcr(lines, scale));
      }
      const annotations = await page.getAnnotations().catch(() => []);
      segs = segs.concat(segmentsFromAnnotations(annotations, vp));
      S.pages[p] = buildPage(segs);
      S.pages[p].ocr = visible < 25;
      page.cleanup();
    }
    progress('Buscando datos personales…', n, n, '');
    const found = detectDocument(S.pages.map(pg => pg.text), S.pages.map(pg => pg.ocr));
    S.detections = found.flatMap((list, p) => list.map(d => ({ id: nextId(), page: p, type: d.type, text: d.text.replace(/\s+/g, ' '), confidence: d.confidence, reason: d.reason, rects: boxesFor(S.pages[p], d.start, d.end), active: true, source: 'auto' }))).filter(d => d.rects.length);
    show('stepReview');
    renderReview();
    const ocrNote = ocrUsed ? ' ' + plural(ocrUsed, 'página era escaneada', 'páginas eran escaneadas') + ': revisa con especial atención.' : '';
    toast(S.detections.length ? 'Se han detectado ' + plural(new Set(S.detections.map(groupKey)).size, 'dato', 'datos') + '. Revísalos antes de descargar.' + ocrNote : 'No se han detectado datos personales. Revisa el documento y añade lo que haga falta.' + ocrNote);
  } catch (err) {
    console.error(err);
    user = await refund(movement).catch(() => user);
    paintCredits();
    toast('No se ha podido analizar el documento. Te hemos devuelto los créditos.');
    showConfirm();
  }
});

// ---------------------------------------------------------------- 4. revisar
function groupKey(d) { return d.source === 'draw' ? d.id : d.type + '|' + fold(d.text).replace(/\s+/g, ' ').trim(); }

function baseScale() {
  const avail = Math.max(280, $('#viewer').clientWidth - 48);
  const widest = Math.max(...S.sizes.map(s => s.w));
  return Math.min(avail, 860) / widest;
}

function renderReview() {
  const pagesBox = $('#pages');
  pagesBox.replaceChildren();
  S.rendered = new Map();
  const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) drawPage(Number(e.target.dataset.page)).catch(err => console.warn('No se pudo dibujar la página', err)); }), { root: $('#viewer'), rootMargin: '800px 0px' });
  S.sizes.forEach((size, p) => {
    const wrap = el('div', { class: 'page-wrap', dataset: { page: p }, role: 'group', 'aria-label': 'Página ' + (p + 1) + ' de ' + S.sizes.length });
    wrap.append(el('span', { class: 'page-no' }, 'Página ' + (p + 1) + (S.pages[p].ocr ? ' · escaneada' : '')), el('canvas', { 'aria-hidden': 'true' }));
    wrap.style.aspectRatio = size.w + ' / ' + size.h;
    pagesBox.append(wrap);
    attachDrawing(wrap, p);
    observer.observe(wrap);
  });
  applyZoom();
  paintBoxes();
  renderList();
}

async function drawPage(p) {
  if (!S.pdf) return;
  const wrap = $('.page-wrap[data-page="' + p + '"]');
  if (!wrap) return;
  const cssW = S.sizes[p].w * baseScale() * S.zoom;
  const scale = Math.min((cssW * (window.devicePixelRatio || 1)) / S.sizes[p].w, 2600 / S.sizes[p].w);
  if (S.rendered.get(p) === scale) return;
  S.rendered.set(p, scale);
  const pdf = S.pdf, rendered = S.rendered;
  const canvas = document.createElement('canvas');
  try {
    const page = await pdf.getPage(p + 1);
    const vp = page.getViewport({ scale });
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    canvas.setAttribute('aria-hidden', 'true');
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  } catch (err) {
    // Si entretanto se cerró el documento (otro archivo, "Anonimizar otro documento"), el dibujo cancelado no importa.
    if (pdf !== S.pdf || err?.name === 'RenderingCancelledException') return;
    rendered.delete(p);
    throw err;
  }
  if (pdf !== S.pdf || S.rendered.get(p) !== scale || !wrap.isConnected) return;
  wrap.querySelector('canvas').replaceWith(canvas);
}

function applyZoom() {
  const b = baseScale();
  $$('.page-wrap').forEach(w => { const p = Number(w.dataset.page); w.style.setProperty('--page-w', Math.round(S.sizes[p].w * b * S.zoom) + 'px'); });
  $('#zoomLevel').textContent = Math.round(S.zoom * 100) + ' %';
  S.rendered.forEach((_, p) => drawPage(p).catch(err => console.warn('No se pudo dibujar la página', err)));
}
let zoomTimer;
function setZoom(z) { S.zoom = Math.max(0.5, Math.min(3, Math.round(z * 100) / 100)); clearTimeout(zoomTimer); $$('.page-wrap').forEach(w => { const p = Number(w.dataset.page); w.style.setProperty('--page-w', Math.round(S.sizes[p].w * baseScale() * S.zoom) + 'px'); }); $('#zoomLevel').textContent = Math.round(S.zoom * 100) + ' %'; zoomTimer = setTimeout(applyZoom, 200); }
$('#zoomIn').addEventListener('click', () => setZoom(S.zoom + 0.25));
$('#zoomOut').addEventListener('click', () => setZoom(S.zoom - 0.25));
window.addEventListener('resize', () => { if (!$('#stepReview').hidden) { clearTimeout(zoomTimer); zoomTimer = setTimeout(applyZoom, 250); } });

$('#peek').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); $('#pages').classList.toggle('peek', on); });
$('#drawMode').addEventListener('click', e => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  $$('.page-wrap').forEach(w => w.classList.toggle('drawing', on));
  $('#viewerHint').textContent = on ? 'Arrastra sobre la página para tapar una zona. Pulsa de nuevo "Dibujar recuadro" para terminar.' : 'Haz clic en un recuadro para quitarlo o volver a ponerlo.';
});

const label = d => (d.source === 'draw' ? 'Recuadro dibujado' : CATEGORIES[d.type].short) + (d.text ? ': ' + d.text : '');
function paintBoxes() {
  $$('.page-wrap').forEach(wrap => {
    const p = Number(wrap.dataset.page), { w, h } = S.sizes[p];
    wrap.querySelectorAll('.box').forEach(b => b.remove());
    for (const d of S.detections.filter(x => x.page === p)) for (const r of d.rects) {
      const b = el('button', { type: 'button', class: 'box ' + (d.active ? 'on' : 'off'), dataset: { id: d.id }, title: label(d) + (d.active ? ' · clic para no censurarlo' : ' · clic para censurarlo'), 'aria-pressed': String(d.active), 'aria-label': (d.active ? 'Se censurará ' : 'No se censurará ') + label(d) });
      b.style.left = (r.x / w * 100) + '%'; b.style.top = (r.y / h * 100) + '%'; b.style.width = (r.w / w * 100) + '%'; b.style.height = (r.h / h * 100) + '%';
      b.addEventListener('click', () => { d.active = !d.active; S.downloaded = false; refresh(); });
      wrap.append(b);
    }
  });
}

function refresh() { paintBoxes(); renderList(); }

function renderList() {
  const groups = new Map();
  for (const d of S.detections) { const k = groupKey(d); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  const active = S.detections.filter(d => d.active).length;
  $('#counts').replaceChildren(el('span', {}, el('strong', {}, String(groups.size)), ' ' + (groups.size === 1 ? 'dato' : 'datos')), el('span', {}, el('strong', {}, String(active)), ' de ' + S.detections.length + ' recuadros activos'));
  const list = $('#list'); list.replaceChildren();
  if (!groups.size) { list.append(el('p', { class: 'empty-list' }, 'No se ha detectado ningún dato personal. Usa "Tapar otro texto" o "Dibujar recuadro" para censurar lo que necesites.')); return; }
  for (const type of ORDER) {
    const gs = [...groups.values()].filter(g => g[0].type === type);
    if (!gs.length) continue;
    const all = gs.flat(), on = all.filter(d => d.active).length;
    const sw = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Censurar todos: ' + CATEGORIES[type].label });
    sw.checked = on === all.length; sw.indeterminate = on > 0 && on < all.length;
    sw.addEventListener('change', () => { all.forEach(d => { d.active = sw.checked; }); S.downloaded = false; refresh(); });
    const section = el('section', { class: 'cat' }, el('div', { class: 'cat-head' }, el('span', { class: 'switch' }, sw), el('span', {}, CATEGORIES[type].label), el('span', { class: 'count' }, String(gs.length))));
    for (const g of gs) section.append(item(g));
    list.append(section);
  }
}

function item(g) {
  const d0 = g[0], on = g.filter(d => d.active).length;
  const cb = el('input', { type: 'checkbox', 'aria-label': 'Censurar ' + (d0.text || 'recuadro dibujado') });
  cb.checked = on === g.length; cb.indeterminate = on > 0 && on < g.length;
  cb.addEventListener('change', () => { g.forEach(d => { d.active = cb.checked; }); S.downloaded = false; refresh(); });
  const pages = [...new Set(g.map(d => d.page + 1))];
  const minConf = Math.min(...g.map(d => d.confidence ?? 1));
  const meta = [(g.length > 1 ? g.length + ' veces · ' : '') + (pages.length > 1 ? 'págs. ' : 'pág. ') + pages.join(', ')];
  if (d0.source === 'search') meta.push('añadido por ti');
  const value = el('button', { type: 'button', class: 'value', title: d0.reason || '' }, d0.text || 'Recuadro dibujado', el('span', { class: 'meta' }, meta.join(' · '), minConf < 0.8 ? ' · ' : '', minConf < 0.8 ? el('span', { class: 'badge badge-warn' }, 'Revisar') : ''));
  value.addEventListener('click', () => focusDetection(g[0]));
  const row = el('div', { class: 'item' + (on ? '' : ' off') }, cb, value);
  if (d0.source !== 'auto') {
    row.append(el('button', { type: 'button', class: 'remove', 'aria-label': 'Quitar de la lista', title: 'Quitar de la lista', onclick: () => { const ids = new Set(g.map(d => d.id)); S.detections = S.detections.filter(d => !ids.has(d.id)); refresh(); } }, '×'));
  } else row.append(el('span'));
  return row;
}

function focusDetection(d) {
  const box = $('.box[data-id="' + d.id + '"]');
  if (!box) return;
  box.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  $$('.box[data-id="' + d.id + '"]').forEach(b => { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); });
}

// Tapar un texto libre en todas sus apariciones.
$('#addTextForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#addText').value.trim(), status = $('#addStatus');
  status.className = 'form-status small';
  if (q.length < 2) { status.textContent = 'Escribe al menos 2 caracteres.'; return; }
  let added = 0, reactivated = 0;
  S.pages.forEach((page, p) => {
    for (const m of findAll(page.text, q)) {
      const rects = boxesFor(page, m.start, m.end);
      if (!rects.length) continue;
      const same = S.detections.find(d => d.page === p && d.rects.length === rects.length && d.rects.every((r, i) => Math.abs(r.x - rects[i].x) < 1 && Math.abs(r.y - rects[i].y) < 1 && Math.abs(r.w - rects[i].w) < 1));
      if (same) { if (!same.active) { same.active = true; reactivated++; } continue; }
      S.detections.push({ id: nextId(), page: p, type: 'manual', text: m.text.replace(/\s+/g, ' '), confidence: 1, reason: 'Añadido por ti', rects, active: true, source: 'search' });
      added++;
    }
  });
  if (!added && !reactivated) { status.className = 'form-status small error'; status.textContent = 'Ese texto no aparece en el documento' + (S.pages.some(pg => pg.ocr) ? ' (en páginas escaneadas, prueba a dibujar un recuadro).' : '.'); return; }
  status.className = 'form-status small ok';
  status.textContent = added ? 'Añadido: ' + plural(added, 'aparición', 'apariciones') + '.' : 'Ya estaba detectado: se ha vuelto a activar.';
  $('#addText').value = '';
  S.downloaded = false;
  refresh();
});

// Dibujar recuadros a mano.
function attachDrawing(wrap, p) {
  let start = null, draft = null;
  const point = e => { const r = wrap.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * S.sizes[p].w, y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * S.sizes[p].h }; };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const place = r => { const { w, h } = S.sizes[p]; draft.style.left = (r.x / w * 100) + '%'; draft.style.top = (r.y / h * 100) + '%'; draft.style.width = (r.w / w * 100) + '%'; draft.style.height = (r.h / h * 100) + '%'; };
  wrap.addEventListener('pointerdown', e => {
    if (!wrap.classList.contains('drawing') || e.button !== 0) return;
    e.preventDefault(); wrap.setPointerCapture(e.pointerId);
    start = point(e); draft = el('div', { class: 'draft' }); wrap.append(draft); place({ ...start, w: 0, h: 0 });
  });
  wrap.addEventListener('pointermove', e => { if (start) place(rectOf(start, point(e))); });
  const finish = e => {
    if (!start) return;
    const r = rectOf(start, point(e)); start = null; draft.remove(); draft = null;
    if (r.w < 4 || r.h < 4) return;
    const under = S.pages[p].segs.filter(s => intersects(segmentBox(s), r)).map(s => s.str).join(' ').replace(/\s+/g, ' ').trim();
    S.detections.push({ id: nextId(), page: p, type: 'manual', text: under.length > 60 ? under.slice(0, 57) + '…' : under, confidence: 1, reason: 'Recuadro dibujado por ti', rects: [r], active: true, source: 'draw' });
    S.downloaded = false;
    refresh();
  };
  wrap.addEventListener('pointerup', finish);
  wrap.addEventListener('pointercancel', () => { start = null; if (draft) draft.remove(); draft = null; });
}

// ---------------------------------------------------------------- 5. descargar
const dialog = $('#exportDialog');
let lastUrl = null;
$('#downloadOpen').addEventListener('click', () => {
  const act = S.detections.filter(d => d.active);
  const pagesWith = new Set(act.map(d => d.page)).size;
  $('#exportSummary').textContent = act.length
    ? 'Se censurarán ' + plural(act.length, 'recuadro', 'recuadros') + ' en ' + plural(pagesWith, 'página', 'páginas') + '. Descargar no gasta créditos.'
    : 'No hay ningún recuadro activo: el PDF se generará sin censurar nada. Descargar no gasta créditos.';
  const base = S.file.name.replace(/\.pdf$/i, '');
  $('#outName').value = base + '-anonimizado.pdf';
  $('#exportOptions').hidden = false; $('#exportProgress').hidden = true; $('#exportResult').hidden = true;
  $('#exportGo').hidden = false; $('#exportGo').disabled = false; $('#exportCancel').textContent = 'Cancelar';
  dialog.showModal();
});
$('#exportCancel').addEventListener('click', () => dialog.close());

$('#exportGo').addEventListener('click', async () => {
  const go = $('#exportGo'); go.disabled = true;
  $('#exportOptions').hidden = true; $('#exportProgress').hidden = false; $('#exportResult').hidden = true;
  const dpi = Number($('#quality').value);
  let keepText = $('#keepText').checked;
  const setP = (i, n, t) => { $('#exportBar').style.width = Math.round(i / Math.max(1, n) * 100) + '%'; $('#exportText').textContent = t; };
  try {
    let bytes, check;
    for (;;) {
      bytes = await exportRedacted({ pdfjs, pdf: S.pdf, pages: S.pages, detections: S.detections, dpi, keepText, onProgress: (i, n) => setP(i, n + 1, i < n ? 'Generando la página ' + (i + 1) + ' de ' + n + '…' : 'Guardando…') });
      setP(1, 1, 'Comprobando que lo censurado no se puede recuperar…');
      check = await verifyRedaction(pdfjs, bytes, S.detections);
      if (!check.leaks.length || !keepText) break;
      keepText = false; // por seguridad, se repite sin capa de texto
    }
    const result = $('#exportResult'); result.replaceChildren();
    if (check.leaks.length) {
      result.append(el('div', { class: 'alert alert-danger', role: 'alert' }, el('p', {}, el('strong', {}, 'No se ha podido verificar la censura. '), 'No descargues este archivo y escríbenos: es un fallo que queremos conocer.')));
    } else {
      let name = $('#outName').value.trim() || 'documento-anonimizado.pdf';
      if (!/\.pdf$/i.test(name)) name += '.pdf';
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = el('a', { class: 'btn btn-ghost btn-sm', href: lastUrl, download: name }, 'Descargar de nuevo');
      const kb = bytes.length / 1024;
      result.append(el('div', { class: 'alert alert-ok', role: 'status' }, el('p', {},
        el('strong', {}, 'PDF censurado y verificado. '),
        check.checked ? 'Hemos abierto el archivo generado y ninguno de los ' + plural(check.checked, 'dato censurado', 'datos censurados') + ' aparece en él. ' : 'Hemos abierto el archivo generado y no contiene el texto de los recuadros. ',
        (keepText ? 'El resto del texto se puede buscar y copiar. ' : $('#keepText').checked ? 'Por seguridad se ha generado sin texto buscable. ' : 'El PDF no contiene texto seleccionable. ') +
        '(' + plural(check.pages, 'página', 'páginas') + ', ' + (kb < 1024 ? Math.round(kb) + ' KB' : (kb / 1024).toFixed(1).replace('.', ',') + ' MB') + ')'), link));
      el('a', { href: lastUrl, download: name }).click();
      S.downloaded = true;
    }
    $('#exportProgress').hidden = true; result.hidden = false;
    go.hidden = true; $('#exportCancel').textContent = 'Cerrar';
  } catch (err) {
    console.error(err);
    $('#exportProgress').hidden = true; $('#exportOptions').hidden = false; go.disabled = false;
    const result = $('#exportResult'); result.hidden = false;
    result.replaceChildren(el('div', { class: 'alert alert-danger', role: 'alert' }, el('p', {}, 'No se ha podido generar el PDF: ' + err.message + (dpi > 150 ? ' Prueba con la calidad Estándar.' : ''))));
  }
});

$('#restart').addEventListener('click', async () => {
  if (!S.downloaded && S.detections.length && !confirm('Aún no has descargado el PDF censurado. ¿Empezar con otro documento? Tendrás que volver a analizarlo (y gastar créditos) si quieres recuperarlo.')) return;
  await closeDoc(); show('stepUpload');
});
window.addEventListener('beforeunload', e => { if (!$('#stepReview').hidden && !S.downloaded) { e.preventDefault(); e.returnValue = ''; } });

show('stepUpload');
