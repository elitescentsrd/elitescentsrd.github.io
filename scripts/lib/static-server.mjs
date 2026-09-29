// Servidor estático mínimo para pruebas: sirve la raíz del repositorio con los tipos MIME que usa GitHub Pages.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.xml': 'text/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

export function startServer(root = '.', port = 0) {
  const base = resolve(root);
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(base, path));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
    try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, url: 'http://127.0.0.1:' + server.address().port })));
}
