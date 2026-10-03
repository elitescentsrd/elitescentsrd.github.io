// Cambia la dirección de la tienda (por ejemplo, a un dominio propio) en todas las páginas, enlaces, datos para Google,
// mapa del sitio, panel y pruebas, de una sola vez.
//   node scripts/cambiar-dominio.mjs www.elitescentsrd.com      (para volver: node scripts/cambiar-dominio.mjs elitescentsrd.github.io)
// Después: npm run build && npm test, guardar (commit) y seguir la guía «Dominio propio» del README (GitHub Pages, DNS,
// Supabase y Google). No toca supabase/ (scripts ya aplicados) ni archive/, ni la dirección del repositorio en GitHub
// (api.github.com/repos/elitescentsrd/elitescentsrd.github.io), que no cambia con el dominio.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_HOST = 'elitescentsrd.github.io';
const TEXT_FILE = /\.(html|mjs|js|txt|xml|md|webmanifest|json|css)$/;
const SKIP = [/^archive\//, /^supabase\//, /^node_modules\//, /^img\//, /^_site\//];
const NOTE_START = '<!--dominio-anterior-->', NOTE_END = '<!--/dominio-anterior-->';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Un nombre de dominio normal: letras, números y guiones, con al menos un punto (sin http://, barras ni espacios).
export function validHost(host) {
  return typeof host === 'string' && host.length <= 253 && /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/.test(host) &&
    (host === DEFAULT_HOST || !/(^|\.)github\.io$/.test(host));
}

export const currentHost = (seo = readFileSync('scripts/lib/seo.mjs', 'utf8')) => {
  const match = seo.match(/export const SITE_URL = 'https:\/\/([^'/]+)';/);
  if (!match) throw new Error('No se encontró SITE_URL en scripts/lib/seo.mjs');
  return match[1];
};

export function changeDomain(text, from, to, file = '') {
  let out = text;
  // La página de canales oficiales avisa que la dirección anterior también es nuestra (se quita al volver a github.io).
  if (file === 'canales-oficiales.html') out = out.replace(new RegExp('\\n' + escape(NOTE_START) + '[\\s\\S]*?' + escape(NOTE_END)), '');
  // Direcciones completas (https://dominio/…) y el dominio escrito como texto visible (>dominio<).
  out = out.replace(new RegExp('https://' + escape(from) + '(?![a-z0-9-]|\\.[a-z0-9])', 'g'), 'https://' + to)
    .replace(new RegExp('>' + escape(from) + '<', 'g'), '>' + to + '<');
  if (file === 'canales-oficiales.html' && to !== DEFAULT_HOST) {
    const at = out.indexOf('</li>', out.indexOf('<li>Nuestra tienda en línea es solo'));
    if (at > 0) out = out.slice(0, at + 5) + '\n' + NOTE_START + '<li>La dirección anterior, <strong>' + DEFAULT_HOST + '</strong>, también es nuestra: te trae aquí automáticamente.</li>' + NOTE_END + out.slice(at + 5);
  }
  return out;
}

export const trackedTextFiles = () => execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(f => TEXT_FILE.test(f) && !SKIP.some(r => r.test(f)));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const to = String(process.argv[2] || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!validHost(to)) {
    console.error('Escribe el dominio así: node scripts/cambiar-dominio.mjs www.elitescentsrd.com (sin http:// ni barras).');
    process.exit(1);
  }
  const from = currentHost();
  if (from === to) { console.log('La tienda ya usa ' + to + '.'); process.exit(0); }
  const changed = [];
  for (const file of trackedTextFiles()) {
    const before = readFileSync(file, 'utf8'), after = changeDomain(before, from, to, file);
    if (after !== before) { writeFileSync(file, after); changed.push(file); }
  }
  console.log('Dirección cambiada de https://' + from + ' a https://' + to + ' en ' + changed.length + ' archivos:\n  ' + changed.join('\n  '));
  console.log('Ahora: npm run build && npm test; luego guarda los cambios y sigue la guía «Dominio propio» del README.');
}
