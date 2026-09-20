// Comprueba un lote de fotos ANTES de subirlo y comprueba que la subida no tocó precios ni disponibilidad.
//
//   node scripts/check-photo-batch.mjs <carpeta> [--max 36] [--expect N] [--log registro.md]
//       Valida cada archivo contra el catálogo público: ID existente, nombre coherente con el producto,
//       sin duplicados, JPG/PNG/WebP, <= 3 MB, >= 500x500 y cabecera legible.
//   node scripts/check-photo-batch.mjs --snapshot-save instantanea.json
//       Guarda id, nombre, precio, tamaño, marca, género, disponibilidad y estado de los 420 productos.
//   node scripts/check-photo-batch.mjs --snapshot-compare instantanea.json
//       Falla si CUALQUIER campo distinto de image_url cambió desde la instantánea.
import { readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { imageSize, MAX_BYTES, MIN_SIDE } from './check-product-images.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const config = await readFile('supabase-config.js', 'utf8');
const base = config.match(/url:\s*['"]([^'"]+)['"]/)?.[1]?.replace(/\/$/, '');
const key = config.match(/publishableKey:\s*['"]([^'"]+)['"]/)?.[1];
const FIELDS = 'id,name,price,size,brand,gender,availability,active,image_url';
const res = await fetch(base + '/rest/v1/products?select=' + FIELDS + '&order=id.asc&limit=1000', { headers: { apikey: key } });
if (!res.ok) throw new Error('Supabase respondió HTTP ' + res.status);
const products = await res.json();
const byId = new Map(products.map(p => [Number(p.id), p]));
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const stable = ({ image_url, ...rest }) => JSON.stringify(rest);

if (opt('--snapshot-save')) {
  await writeFile(opt('--snapshot-save'), JSON.stringify(products.map(({ image_url, ...rest }) => rest), null, 1));
  console.log('Instantánea guardada: ' + products.length + ' productos (sin image_url).');
  process.exit(0);
}
if (opt('--snapshot-compare')) {
  const saved = JSON.parse(await readFile(opt('--snapshot-compare'), 'utf8'));
  const savedMap = new Map(saved.map(p => [Number(p.id), JSON.stringify(p)]));
  const changed = products.filter(p => savedMap.get(Number(p.id)) !== stable(p)).map(p => '#' + p.id + ' ' + p.name);
  const missing = saved.filter(p => !byId.has(Number(p.id))).map(p => '#' + p.id + ' ' + p.name);
  if (changed.length || missing.length) { console.error('Cambiaron campos distintos de image_url:\n - ' + [...changed, ...missing.map(m => m + ' (ya no existe)')].join('\n - ')); process.exit(1); }
  console.log('Precios, disponibilidad y demás datos intactos en ' + saved.length + ' productos (solo image_url pudo cambiar).');
  process.exit(0);
}

const dir = args.find(a => !a.startsWith('--') && a !== opt('--max') && a !== opt('--expect') && a !== opt('--log'));
if (!dir) { console.error('Uso: node scripts/check-photo-batch.mjs <carpeta> [--max 36] [--expect N] [--log registro.md]'); process.exit(2); }
const max = Number(opt('--max') || 36);
const files = (await readdir(dir)).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const rows = [], seen = new Map();
for (const file of files) {
  const problems = [];
  const id = /^(\d{1,9})[-_.]/.exec(file)?.[1];
  const product = id ? byId.get(Number(id)) : null;
  if (!id) problems.push('el nombre no empieza con el ID y un guion');
  else if (!product) problems.push('no existe un producto con ID ' + Number(id));
  else {
    if (!slug(product.name).startsWith(slug(file.slice(id.length + 1, file.length - extname(file).length)).slice(0, 25))) problems.push('el nombre del archivo no coincide con "' + product.name + '"');
    if (product.image_url) problems.push('el producto ya tiene foto (se omitiría salvo que marques "Reemplazar")');
    if (seen.has(Number(id))) problems.push('ID repetido con ' + seen.get(Number(id)));
    seen.set(Number(id), file);
  }
  const info = await stat(join(dir, file));
  if (info.size > MAX_BYTES) problems.push('pesa ' + (info.size / 1048576).toFixed(1) + ' MB');
  const size = imageSize(await readFile(join(dir, file)));
  if (!size) problems.push('cabecera de imagen ilegible');
  else if (size.width < MIN_SIDE || size.height < MIN_SIDE) problems.push('mide ' + size.width + 'x' + size.height);
  rows.push({ file, id: id ? Number(id) : null, name: product?.name, dims: size ? size.width + 'x' + size.height : '—', kb: Math.round(info.size / 1024), problems });
}
if (files.length > max) rows.push({ file: '(lote)', problems: ['hay ' + files.length + ' archivos; el máximo por carga es ' + max] });
if (opt('--expect') && Number(opt('--expect')) !== files.length) rows.push({ file: '(lote)', problems: ['se esperaban ' + opt('--expect') + ' archivos y hay ' + files.length] });

const failed = rows.filter(r => r.problems.length);
for (const r of rows) console.log((r.problems.length ? 'FALLO ' : 'ok    ') + r.file + (r.name ? '  ->  #' + r.id + ' ' + r.name : '') + '  ' + (r.dims || '') + '  ' + (r.kb ?? '') + ' KB' + (r.problems.length ? '   [' + r.problems.join('; ') + ']' : ''));
console.log('\nLote: ' + files.length + ' archivos, ' + (files.length - failed.filter(r => r.file !== '(lote)').length) + ' correctos, ' + failed.length + ' con problemas.');
if (opt('--log')) {
  await appendFile(opt('--log'), '\n## ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' — ' + dir + '\n- Esperados/archivos: ' + (opt('--expect') || '—') + ' / ' + files.length + '\n- Correctos: ' + (files.length - failed.length) + '\n- IDs: ' + [...seen.keys()].join(', ') + '\n- Errores: ' + (failed.length ? failed.map(r => r.file + ': ' + r.problems.join('; ')).join(' | ') : 'ninguno') + '\n');
}
process.exit(failed.length ? 1 : 0);
