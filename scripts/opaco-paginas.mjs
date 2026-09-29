// Monta las páginas HTML de Opaco (opaco/*.html) a partir de src/opaco/*.html y de la cabecera y el pie comunes.
// Cada archivo de src/opaco/ empieza con un comentario JSON: <!--{"title": "...", "description": "...", ...}-->
// Uso: node scripts/opaco-paginas.mjs   (y "--check" para comprobar que opaco/ está al día sin escribir nada)
import { readdir, readFile, writeFile } from 'node:fs/promises';

const SRC = 'src/opaco', OUT = 'opaco';
export const SITE = 'https://elitescentsrd.github.io/opaco';
const check = process.argv.includes('--check');

const CSP = {
  web: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  // La herramienta necesita WebAssembly (decodificador de imágenes de pdf.js y OCR) y workers propios.
  app: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
};

const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="3" width="22" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="9" y="9" width="14" height="4.5" fill="#0a0a0a"/><path d="M9 18h14M9 22.5h9" stroke="currentColor" stroke-width="2.2"/></svg>';

const demoBar = '<div class="demo-bar" role="note"><strong>Versión de demostración.</strong> Los pagos son simulados: no se cobra nada ni se piden datos de tarjeta.</div>';

const publicHeader = `<header class="site-header"><div class="container">
  <a class="brand" href="./">${LOGO}<span>Opaco</span></a>
  <nav class="nav" aria-label="Principal"><a href="./#como-funciona">Cómo funciona</a><a href="./#seguridad">Seguridad</a><a href="./#precios">Precios</a><a href="./#preguntas">Preguntas</a></nav>
  <div class="header-actions">
    <span data-auth="out"><a class="btn btn-ghost btn-sm hide-sm" href="acceso.html">Entrar</a> <a class="btn btn-primary btn-sm" href="acceso.html?modo=registro">Probar gratis</a></span>
    <span data-auth="in" hidden><a class="btn btn-ghost btn-sm hide-sm" href="cuenta.html">Mi cuenta</a> <a class="btn btn-primary btn-sm" href="app.html">Abrir Opaco</a></span>
  </div>
</div></header>`;

const appHeader = `<header class="site-header app-header"><div class="container">
  <a class="brand" href="./">${LOGO}<span>Opaco</span></a>
  <div class="header-actions" data-auth="in" hidden>
    <a class="credit-pill" href="cuenta.html" data-user="pill" title="Créditos disponibles (1 crédito = 1 página)"><span class="hide-sm">Créditos</span> <strong><span data-user="credits">0</span> / <span data-user="allotment">0</span></strong><span class="meter" data-user="meter"><span></span></span></a>
    <a class="btn btn-ghost btn-sm hide-sm" href="pago.html">Mejorar plan</a>
    <div class="menu">
      <button class="btn btn-ghost btn-sm" id="menuButton" aria-haspopup="true" aria-expanded="false" aria-controls="menuList"><span data-user="name">Cuenta</span> ▾</button>
      <div class="menu-list" id="menuList" hidden>
        <div class="who"><strong data-user="name"></strong><span data-user="email"></span><br>Plan <span data-user="plan"></span></div>
        <a href="app.html">Anonimizar un documento</a>
        <a href="cuenta.html">Mi cuenta y créditos</a>
        <a href="pago.html">Planes y precios</a>
        <button type="button" data-action="logout">Cerrar sesión</button>
      </div>
    </div>
  </div>
</div></header>`;

const footer = `<footer class="site-footer"><div class="container">
  <div class="footer-grid">
    <div><a class="brand" href="./">${LOGO}<span>Opaco</span></a><p class="muted small footer-about">Anonimización de documentos PDF para gestorías, despachos de abogados y departamentos de recursos humanos. Los documentos se procesan en tu navegador y no se suben a ningún servidor.</p></div>
    <div><h4>Producto</h4><ul><li><a href="./#como-funciona">Cómo funciona</a></li><li><a href="./#precios">Precios</a></li><li><a href="app.html">Abrir la herramienta</a></li><li><a href="acceso.html">Entrar</a></li></ul></div>
    <div><h4>Legal</h4><ul><li><a href="aviso-legal.html">Aviso legal</a></li><li><a href="privacidad.html">Política de privacidad</a></li><li><a href="terminos.html">Términos y condiciones</a></li><li><a href="cookies.html">Política de cookies</a></li></ul></div>
  </div>
  <div class="footer-bottom"><span>© 2026 Opaco</span><span>Versión de demostración · los pagos son simulados</span></div>
</div></footer>`;

function page(meta, body) {
  const app = meta.layout === 'app';
  const url = SITE + '/' + (meta.file === 'index.html' ? '' : meta.file);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP[meta.csp || 'web']}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${meta.title}</title>
<meta name="description" content="${meta.description}">
${meta.private ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${url}">`}
<meta property="og:type" content="website">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/img/despues.png">
<meta name="theme-color" content="#1e3a5f">
<link rel="icon" href="img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="css/opaco.css">
<script src="js/frame-guard.js"></script>
${meta.script ? `<script type="module" src="js/${meta.script}"></script>\n` : ''}</head>
<body${meta.bodyClass ? ` class="${meta.bodyClass}"` : ''}>
<a class="skip" href="#main">Saltar al contenido</a>
${demoBar}
${app ? appHeader : publicHeader}
<main id="main">
${body.trim()}
</main>
${meta.noFooter ? '' : footer}
</body>
</html>
`;
}

let stale = [];
for (const name of (await readdir(SRC)).filter(n => n.endsWith('.html')).sort()) {
  const src = await readFile(SRC + '/' + name, 'utf8');
  const m = src.match(/^<!--(\{[\s\S]*?\})-->\s*/);
  if (!m) throw new Error(name + ': falta la cabecera JSON');
  const meta = { ...JSON.parse(m[1]), file: name };
  const html = page(meta, src.slice(m[0].length));
  const target = OUT + '/' + name;
  if (check) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== html) stale.push(target);
  } else await writeFile(target, html);
}
if (check && stale.length) { console.error('Páginas de Opaco sin regenerar (ejecuta node scripts/opaco-paginas.mjs): ' + stale.join(', ')); process.exit(1); }
console.log(check ? 'Páginas de Opaco al día.' : 'Páginas de Opaco generadas.');
