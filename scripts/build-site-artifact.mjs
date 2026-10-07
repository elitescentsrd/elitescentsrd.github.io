// Copies only the files GitHub Pages should actually serve into _site/.
// Keeps fuentes internas (data/, supabase/, scripts/, src/, archive/,
// documentación, etc.) fuera del sitio publicado, aunque sigan versionadas en Git.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { renderProductPage, renderDirectory, productPath } from './lib/seo.mjs';
import { merchantFeed } from './lib/feeds.mjs';
import { renderPriceList } from './lib/lista-precios.mjs';

const OUT = '_site';

// Archivos sueltos que el sitio realmente sirve.
const FILES = [
  'index.html',
  'perfumes.json',
  'favicon.ico',
  'admin.html',
  'admin.js',
  'checkout.html',
  'customer.js',
  'privacidad.html',
  'aviso-legal.html',
  'pedidos-envios.html',
  'canales-oficiales.html',
  'contacto.html',
  'contacto.js',
  'resena.html',
  'resena.js',
  'encuesta.html',
  '404.html',
  'tienda.css',
  'tienda.js',
  'movimiento.js',
  'cookies.js',
  'analytics.js',
  'medicion.js',
  'frame-guard.js',
  'aroma.js',
  'sales.js',
  'finanzas.js',
  'lista-precios.js',
  'lista-precios.css',
  'survey.js',
  'encuesta.js',
  'pwa.js',
  'sw.js',
  'offline.html',
  'manifest.webmanifest',
  'admin.webmanifest',
  'checkout.css',
  'admin.css',
  'supabase-config.js',
  'robots.txt',
  'sitemap.xml',
  'logo-oficial.webp',
  'featured.webp',
  'social-card.png',
];

// Carpetas públicas: las fotos individuales de producto (img/productos/) y Opaco (opaco/, la herramienta de
// anonimización de PDF, independiente de la tienda). El catálogo antiguo (láminas) quedó archivado en archive/.
const DIRS = ['img', 'opaco'];

// Nunca deben aparecer en el artefacto publicado, aunque alguien los
// reintroduzca sin querer en FILES/DIRS más arriba.
const FORBIDDEN_SUBSTRINGS = [
  'supabase/', 'scripts/', 'data/', 'src/', 'archive/', '.github/', '.git/',
  'pages/', 'catalogo', 'prepared-product-images/', 'fotos-preparadas/',
  'README', 'package.json', 'package-lock.json', 'node_modules/',
  '.md', '.sql', '.csv', '.mjs', '.cjs',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const file of FILES) {
  if (!existsSync(file)) throw new Error('Falta un archivo público esperado: ' + file);
  await cp(file, OUT + '/' + file);
}
for (const dir of DIRS) {
  if (!existsSync(dir)) throw new Error('Falta una carpeta pública esperada: ' + dir);
  await cp(dir, OUT + '/' + dir, { recursive: true });
}
// Verificación de Google Search Console: Google entrega un archivo googleXXXXXXXXXXXXXXXX.html que debe quedar en la raíz, sin cambios.
for (const name of await readdir('.')) {
  if (!/^google[0-9a-f]{16}\.html$/.test(name)) continue;
  if (!(await readFile(name, 'utf8')).includes('google-site-verification: ' + name)) console.warn('Aviso: ' + name + ' no trae el texto que pide Google; la verificación fallará.');
  await cp(name, OUT + '/' + name);
}

// El service worker guarda copias con un nombre que incluye la versión: cada publicación (commit) trae una nueva
// y así las copias antiguas se borran solas en los celulares de los clientes.
{
  const buildId = (process.env.GITHUB_SHA || '').slice(0, 8) || 'local';
  const swPath = OUT + '/sw.js';
  const sw = await readFile(swPath, 'utf8');
  if (!sw.includes('__BUILD_ID__')) throw new Error('sw.js perdió el marcador __BUILD_ID__.');
  const stamped = sw.replaceAll('__BUILD_ID__', buildId);
  if (stamped.includes('__BUILD_ID__') || !stamped.includes("'elite-v" + buildId + "'")) throw new Error('No se pudo versionar sw.js.');
  await writeFile(swPath, stamped);
}

async function listAll(base, prefix = '') {
  const entries = await readdir(base, { withFileTypes: true });
  let out = [];
  for (const entry of entries) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out = out.concat(await listAll(base + '/' + entry.name, rel + '/'));
    else out.push(rel);
  }
  return out;
}

// Una página indexable por perfume (título, descripción, foto, precio y datos estructurados propios) y la lista
// completa /perfumes/. Se generan desde perfumes.json (lo escribe npm run build); no se versionan porque cambian con cada build.
{
  if (!existsSync('perfumes.json')) throw new Error('Falta perfumes.json; ejecuta npm run build antes de npm run site.');
  const products = JSON.parse(await readFile('perfumes.json', 'utf8'));
  if (!Array.isArray(products) || !products.length) throw new Error('perfumes.json está vacío.');
  // Reseñas verificadas publicadas (las escribe npm run build en data/resenas.json; sin ese archivo no hay reseñas).
  const reviews = existsSync('data/resenas.json') ? JSON.parse(await readFile('data/resenas.json', 'utf8')) : {};
  await mkdir(OUT + '/perfumes', { recursive: true });
  await writeFile(OUT + '/perfumes/index.html', renderDirectory(products));
  for (const p of products) {
    const related = p.brand ? products.filter(x => x.brand === p.brand && x.id !== p.id).slice(0, 6) : [];
    await writeFile(OUT + productPath(p), renderProductPage(p, related, reviews[String(p.id)] || []));
  }
  console.log('Páginas de perfume generadas: ' + products.length + ' (y la lista completa /perfumes/), ' + Object.keys(reviews).length + ' con reseñas.');
  // Archivo de productos para Google Merchant Center e Instagram/Facebook: /feeds/productos.xml
  const feed = merchantFeed(products);
  await mkdir(OUT + '/feeds', { recursive: true });
  await writeFile(OUT + '/feeds/productos.xml', feed.xml);
  console.log('Archivo de productos para Google/Instagram: ' + feed.included + ' perfumes (omitidos: ' + feed.skipped.length + ').');
  // Lista de precios imprimible (PDF), siempre al día con el catálogo publicado.
  await writeFile(OUT + '/lista-de-precios.html', renderPriceList(products));
  console.log('Lista de precios imprimible: /lista-de-precios.html (' + products.length + ' perfumes).');
}

const shipped = await listAll(OUT);
const leaked = shipped.filter(path => FORBIDDEN_SUBSTRINGS.some(bad => path.includes(bad)));
if (leaked.length) {
  throw new Error('El artefacto de _site/ contiene rutas internas que no deben publicarse: ' + leaked.join(', '));
}

// Búsqueda global: ningún archivo público puede referir a las láminas antiguas.
const TEXT = /\.(html|js|css|xml|txt|json)$/;
const offenders = [];
for (const path of shipped.filter(p => TEXT.test(p))) {
  const body = await readFile(OUT + '/' + path, 'utf8');
  if (/\/pages\/page-\d|catalogo\.html|catalogo-app|catalogo-viewer|catalogo-data-/.test(body)) offenders.push(path);
}
if (offenders.length) {
  throw new Error('Referencias a láminas/catálogo antiguo en la salida pública: ' + offenders.join(', '));
}

console.log('Artefacto _site/ listo: ' + shipped.length + ' archivos, sin rutas internas ni referencias a láminas.');
