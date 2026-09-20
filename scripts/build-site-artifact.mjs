// Copies only the files GitHub Pages should actually serve into _site/.
// Keeps fuentes internas (data/, supabase/, scripts/, src/, catalogo-data-*.js,
// documentación, etc.) fuera del sitio publicado, aunque sigan versionadas en Git.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const OUT = '_site';

// Archivos sueltos que el sitio realmente sirve.
const FILES = [
  'index.html',
  'admin.html',
  'admin.js',
  'checkout.html',
  'customer.js',
  'privacidad.html',
  'pedidos-envios.html',
  '404.html',
  'tienda.css',
  'tienda.js',
  'checkout.css',
  'admin.css',
  'supabase-config.js',
  'robots.txt',
  'sitemap.xml',
  'logo-oficial.webp',
  'featured.webp',
  'social-card.png',
];

// Carpetas completas que el sitio necesita en tiempo de ejecución.
// `pages/` sigue siendo necesaria: mientras no existan las 420 fotos
// individuales (ver hallazgo I-01), las tarjetas del catálogo recortan estas
// láminas con CSS background-position. No incluye catalogo.html (el visor
// completo de las 36 láminas), que se retira intencionalmente del artefacto.
const DIRS = ['pages'];

// Nunca deben aparecer en el artefacto publicado, aunque alguien los
// reintroduzca sin querer en FILES/DIRS más arriba.
const FORBIDDEN_SUBSTRINGS = [
  'supabase/', 'scripts/', 'data/', 'src/', '.github/', '.git/',
  'catalogo-data-', 'catalogo.html', 'prepared-product-images/',
  'README', 'package.json', 'package-lock.json', 'node_modules/',
  '.md', '.sql', '.csv',
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

const shipped = await listAll(OUT);
const leaked = shipped.filter(path => FORBIDDEN_SUBSTRINGS.some(bad => path.includes(bad)));
if (leaked.length) {
  throw new Error('El artefacto de _site/ contiene rutas internas que no deben publicarse: ' + leaked.join(', '));
}

console.log('Artefacto _site/ listo: ' + shipped.length + ' archivos, sin rutas internas.');
