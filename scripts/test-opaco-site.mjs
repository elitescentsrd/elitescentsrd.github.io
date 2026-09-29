// Pruebas estáticas de Opaco (sin red ni navegador): páginas generadas al día, seguridad de cada página (CSP, sin
// código en línea, protección contra marcos, sin recursos externos), enlaces internos y archivos necesarios.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/opaco-paginas.mjs', '--check'], { stdio: 'inherit' });

const pages = (await readdir('opaco')).filter(f => f.endsWith('.html'));
for (const p of ['index.html', 'acceso.html', 'app.html', 'cuenta.html', 'pago.html', 'aviso-legal.html', 'privacidad.html', 'terminos.html', 'cookies.html']) assert(pages.includes(p), 'Falta la página ' + p);

for (const name of pages) {
  const html = await readFile('opaco/' + name, 'utf8');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert(csp, name + ': falta la CSP');
  const d = Object.fromEntries(csp.split(';').map(x => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(d['default-src'], ["'self'"], name + ': default-src');
  assert(d['script-src'].every(v => ["'self'", "'wasm-unsafe-eval'"].includes(v)), name + ': solo scripts propios');
  assert(name === 'app.html' || !d['script-src'].includes("'wasm-unsafe-eval'"), name + ': WebAssembly solo en la herramienta');
  assert.deepEqual(d['object-src'], ["'none'"]); assert.deepEqual(d['form-action'], ["'self'"]);
  assert(!/unsafe-inline|unsafe-eval'|\*/.test(csp.replace("'wasm-unsafe-eval'", '')), name + ': sin unsafe-inline/eval ni comodines');
  assert(!/https?:\/\//.test(Object.entries(d).filter(([k]) => k.endsWith('-src')).flatMap(([, v]) => v).join(' ')), name + ': sin orígenes externos');
  assert(html.includes('<script src="js/frame-guard.js"></script>'), name + ': protección contra marcos');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) assert(/\bsrc=/.test(m[1]) && !m[2].trim(), name + ': sin JavaScript en línea');
  assert(!/\sstyle="/.test(html), name + ': sin estilos en línea (los bloquea la CSP)');
  assert(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), name + ': sin manejadores en línea');
  assert(!/(src|href)="(https?:)?\/\/(?!elitescentsrd\.github\.io)/.test(html.replace(/<meta[^>]+>/g, '').replace(/<link rel="canonical"[^>]+>/, '')), name + ': sin recursos de otros dominios');
  for (const a of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert(/rel="[^"]*noopener/.test(a[0]), name + ': rel=noopener');
  assert(html.includes('Versión de demostración'), name + ': aviso de demostración visible');
  // Enlaces y recursos internos que existan.
  for (const m of html.matchAll(/(?:href|src)="([^"#?:]+)(?:[?#][^"]*)?"/g)) {
    const target = m[1] === './' ? 'index.html' : m[1];
    if (target.startsWith('/')) continue;
    assert(existsSync('opaco/' + target), name + ': enlace roto ' + m[1]);
  }
  if (['acceso.html', 'app.html', 'cuenta.html', 'pago.html'].includes(name)) assert(html.includes('noindex'), name + ': privada, no indexable');
}

// Módulos: todo import relativo apunta a un archivo que existe.
for (const f of (await readdir('opaco/js')).filter(f => f.endsWith('.js'))) {
  const src = await readFile('opaco/js/' + f, 'utf8');
  for (const m of src.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) assert(existsSync(new URL(m[1], new URL('../opaco/js/' + f, import.meta.url))), f + ': no existe ' + m[1]);
  assert(!/\beval\(|new Function|innerHTML\s*=|document\.write/.test(src), f + ': patrón peligroso');
}
for (const f of ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/pdf-lib.esm.min.js', 'vendor/tesseract/tesseract.esm.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/tesseract-core-lstm.wasm.js', 'vendor/tesseract/spa.traineddata', 'img/antes.png', 'img/despues.png', 'ejemplos/nomina-ejemplo.pdf', 'ejemplos/contrato-ejemplo.pdf', 'ejemplos/factura-escaneada-ejemplo.pdf']) assert(existsSync('opaco/' + f), 'Falta opaco/' + f);

// Los pagos están señalizados como simulados y no hay ningún campo de tarjeta activo.
const pago = await readFile('opaco/pago.html', 'utf8');
assert(/no se cobra nada/.test(pago));
for (const input of pago.matchAll(/<input\b[^>]*>/g)) assert(/\bdisabled\b/.test(input[0]), 'pago.html: los campos de tarjeta deben estar bloqueados');

console.log('Pruebas estáticas de Opaco superadas (' + pages.length + ' páginas).');
