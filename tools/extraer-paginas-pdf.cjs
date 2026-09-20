/* Herramienta opcional: extrae los JPEG incrustados (una imagen por pagina) del PDF del catalogo, sin librerias.
 * Uso: node tools/extraer-paginas-pdf.cjs <catalogo.pdf> <carpeta-salida> */
const fs = require('fs'), path = require('path');
const pdf = process.argv[2] || 'catalogo.pdf';
const out = process.argv[3] || 'catalogo-pdf-paginas';
fs.mkdirSync(out, { recursive: true });
const buf = fs.readFileSync(pdf);
const s = buf.toString('latin1');
const pages = [];
const re = /\/Subtype\s*\/Image/g; let m;
while ((m = re.exec(s))) {
  const st = s.indexOf('stream', m.index);
  let a = st + 6; if (s[a] === '\r') a++; if (s[a] === '\n') a++;
  const e = s.indexOf('endstream', a);
  let b = e; while (b > a && (s[b - 1] === '\n' || s[b - 1] === '\r')) b--;
  const data = buf.subarray(a, b);
  if (data[0] === 0xff && data[1] === 0xd8) pages.push(data);
}
pages.forEach((d, i) => fs.writeFileSync(path.join(out, 'page-' + String(i + 1).padStart(2, '0') + '.jpg'), d));
console.log('paginas extraidas:', pages.length, 'MB:', (pages.reduce((n, d) => n + d.length, 0) / 1048576).toFixed(1));
