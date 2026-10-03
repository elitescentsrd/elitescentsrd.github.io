// Enlaces rotos: revisa el sitio publicado (_site/, después de npm run site) sin salir a internet.
//  - Cada enlace interno (href, src, srcset, action) apunta a un archivo que existe en _site/.
//  - Cada ancla (#algo) existe en su página; #producto-ID y #avisame-ID las abre la tienda y el ID debe existir.
//  - Los enlaces externos usan https (o tel:, mailto:, wa.me) y las direcciones de WhatsApp llevan el número oficial.
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';

const OUT = '_site';
if (!existsSync(OUT)) { console.error('Falta _site/: ejecuta npm run site antes de npm run test:links.'); process.exit(2); }

async function walk(dir, prefix = '') {
  let out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out = out.concat(await walk(join(dir, entry.name), rel + '/'));
    else out.push(rel);
  }
  return out;
}
const files = await walk(OUT);
const pages = files.filter(f => f.endsWith('.html') && !f.startsWith('opaco/'));
const fileSet = new Set(files);
const idsCache = new Map();
// Anclas válidas: los id de la página y las secciones del panel (#pedidos abre la sección data-view="pedidos").
async function idsOf(path) {
  if (!idsCache.has(path)) idsCache.set(path, new Set([...(await readFile(join(OUT, path), 'utf8')).matchAll(/\s(?:id|data-view)="([^"]+)"/g)].map(m => m[1])));
  return idsCache.get(path);
}
const catalog = JSON.parse(await readFile(join(OUT, 'perfumes.json'), 'utf8'));
const productIds = new Set(catalog.map(p => String(p.id)));

// /ruta → archivo de _site/ (como lo sirve GitHub Pages: /carpeta/ → carpeta/index.html).
function target(path) {
  const clean = decodeURI(path.replace(/^\//, ''));
  if (clean === '' || clean.endsWith('/')) return clean + 'index.html';
  if (fileSet.has(clean)) return clean;
  if (fileSet.has(clean + '/index.html')) return clean + '/index.html';
  return null;
}

const broken = [];
let checked = 0;
for (const page of pages) {
  const html = await readFile(join(OUT, page), 'utf8');
  const refs = [];
  for (const m of html.matchAll(/\s(href|src|action)="([^"]*)"/g)) refs.push(m[2]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of m[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
  for (const raw of refs) {
    const ref = raw.replace(/&amp;/g, '&');
    checked++;
    // offline.html: «Reintentar» usa href="" a propósito (vuelve a pedir la dirección que falló).
    if (!ref) { if (page !== 'offline.html') broken.push(page + ': enlace vacío'); continue; }
    if (/^(tel:|mailto:|data:|javascript:void)/.test(ref)) continue;
    if (/^javascript:/i.test(ref)) { broken.push(page + ': enlace javascript: ' + ref); continue; }
    if (/^https?:\/\//i.test(ref)) {
      if (!/^https:\/\//i.test(ref) && !/^http:\/\/base\.google\.com\//.test(ref)) broken.push(page + ': enlace sin https: ' + ref);
      if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(ref) && !/wa\.me\/18094333348(\?|$)/.test(ref)) broken.push(page + ': WhatsApp que no es el número oficial: ' + ref);
      continue;
    }
    const [pathPart, hash = ''] = ref.split('#');
    const path = pathPart.split('?')[0];
    let file = page;
    if (path) {
      const absolute = path.startsWith('/') ? path : '/' + posix.join(posix.dirname(page), path);
      file = target(absolute);
      if (!file) { broken.push(page + ': no existe ' + ref); continue; }
    }
    if (!hash) continue;
    if (/^(producto|avisame)-\d+$/.test(hash)) {
      if (!productIds.has(hash.split('-')[1])) broken.push(page + ': ' + ref + ' (ese perfume no está en el catálogo)');
      continue;
    }
    if (file.endsWith('.html') && !(await idsOf(file)).has(hash)) broken.push(page + ': falta el ancla #' + hash + ' en ' + file);
  }
}
if (broken.length) {
  console.error('Enlaces rotos (' + broken.length + '):\n - ' + [...new Set(broken)].slice(0, 80).join('\n - '));
  process.exit(1);
}
console.log('Enlaces: ' + checked + ' revisados en ' + pages.length + ' páginas, ninguno roto.');
