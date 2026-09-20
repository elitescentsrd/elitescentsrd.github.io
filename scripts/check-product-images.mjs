// Valida las fotos individuales de producto que ya están registradas en Supabase.
//
// Reglas (ver plan de continuidad):
//  - responden 200 por HTTPS, tipo JPG/PNG/WebP, pesan como máximo 3 MB y miden al menos 500x500;
//  - ninguna URL puede apuntar a una lámina (/pages/page-XX);
//  - el JSON-LD de index.html usa la misma URL individual que el producto;
//  - a partir de la fecha de corte (IMAGE_CUTOFF, por defecto 2026-10-20) TODOS los productos activos deben tener foto.
// Antes de la fecha de corte solo se validan las fotos que ya existan.
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const MAX_BYTES = 3 * 1024 * 1024;
export const MIN_SIDE = 500;
const TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);

// Lee ancho y alto directamente de la cabecera del archivo (sin dependencias).
export function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = buf.readUInt16BE(i + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { type: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
    return null;
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    if (chunk === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

// Devuelve la lista de problemas de una imagen ya descargada (vacía si es válida).
export function imageProblems({ url, status, contentType, body }) {
  const problems = [];
  if (!/^https:\/\//i.test(url)) problems.push('no es HTTPS');
  if (/\/pages\/page-/i.test(url)) problems.push('apunta a una lámina del catálogo');
  if (status !== 200) problems.push('HTTP ' + status);
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.has(type)) problems.push('tipo no permitido: ' + (type || 'desconocido'));
  if (body.length > MAX_BYTES) problems.push('pesa ' + (body.length / 1048576).toFixed(1) + ' MB (máx. 3 MB)');
  const size = imageSize(body);
  if (!size) problems.push('no se puede leer como imagen');
  else if (size.width < MIN_SIDE || size.height < MIN_SIDE) problems.push('mide ' + size.width + 'x' + size.height + ' (mín. 500x500)');
  return problems;
}

async function run() {
  const cutoff = new Date((process.env.IMAGE_CUTOFF || '2026-10-20') + 'T00:00:00-04:00');
  const strict = Date.now() >= cutoff.getTime();
  const config = await readFile('supabase-config.js', 'utf8');
  const base = config.match(/url:\s*['"]([^'"]+)['"]/)?.[1];
  const key = config.match(/publishableKey:\s*['"]([^'"]+)['"]/)?.[1];
  if (!base || !key) throw new Error('No se encontró la configuración pública de Supabase.');
  const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/products?select=id,name,image_url&active=eq.true&order=id.asc&limit=1000', { headers: { apikey: key } });
  if (!response.ok) throw new Error('Supabase respondió HTTP ' + response.status);
  const products = await response.json();
  const withImage = products.filter(p => p.image_url);
  // Fotos guardadas en el sitio (img/productos/<ID>-<nombre>.jpg): también cuentan como foto individual.
  const localIds = new Set();
  try { for (const f of await readdir('img/productos')) { const m = /^([0-9]{4,})-[a-z0-9-]+\.(jpe?g|png|webp)$/i.exec(f); if (m) localIds.add(Number(m[1])); } } catch { /* sin carpeta */ }
  const withoutAny = products.filter(p => !p.image_url && !localIds.has(Number(p.id)));
  console.log('Fotos individuales: ' + (products.length - withoutAny.length) + ' de ' + products.length + ' (' + withImage.length + ' en Supabase, ' + localIds.size + ' en el sitio)' + (strict ? ' — fecha de corte alcanzada: se exigen todas' : ' — aún antes de la fecha de corte'));

  const failures = [];
  if (strict && withoutAny.length) failures.push('Faltan fotos: ' + withoutAny.length + ' productos sin foto (ni en Supabase ni en img/productos)');

  const queue = [...withImage];
  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        const res = await fetch(p.image_url);
        const body = Buffer.from(await res.arrayBuffer());
        const problems = imageProblems({ url: p.image_url, status: res.status, contentType: res.headers.get('content-type'), body });
        if (problems.length) failures.push('#' + p.id + ' ' + p.name + ': ' + problems.join('; '));
      } catch (err) { failures.push('#' + p.id + ' ' + p.name + ': ' + err.message); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  // JSON-LD: la misma foto individual que el producto y nunca una lámina.
  try {
    const html = await readFile('index.html', 'utf8');
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).filter(s => s['@type'] === 'Product');
    const byName = new Map(schemas.map(s => [s.name, s]));
    for (const p of withImage) {
      const schema = byName.get(p.name);
      if (schema && !(schema.image || []).includes(p.image_url)) failures.push('#' + p.id + ' ' + p.name + ': el JSON-LD de index.html no usa su foto (ejecuta npm run build)');
    }
  } catch { /* index.html se valida en test-site.mjs */ }

  if (failures.length) {
    console.error('Problemas con las fotos de producto:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('Fotos de producto correctas: ' + withImage.length + ' validadas.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
