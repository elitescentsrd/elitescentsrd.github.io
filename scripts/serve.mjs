// Servidor local mínimo para revisar _site/ antes de publicar (http://localhost:4173).
// Sirve exactamente lo que se publicaría en GitHub Pages, así que sirve para:
//  - revisar la tienda en móvil y escritorio antes de fusionar una rama;
//  - usar el panel /admin.html contra Supabase (por ejemplo, la carga de fotos por lote)
//    sin desplegar nada a producción.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 4173);
const ROOT = '_site';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'text/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

http.createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}).listen(PORT, '127.0.0.1', () => console.log('Sitio de revisión en http://localhost:' + PORT + ' (Ctrl+C para detener)'));
