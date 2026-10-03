# Elite Scents RD

Tienda web de Elite Scents RD: catálogo de fragancias con búsqueda y filtros, alojado en GitHub Pages, y consultas por WhatsApp.

## Tecnología

Sitio estático en HTML, CSS y JavaScript nativo (sin frameworks ni bundler). Node.js se usa solo para generar el catálogo estático durante el build; no hay dependencias npm externas.

## Desarrollo

```bash
npm run build       # genera index.html a partir de src/index.template.html
npm test            # pruebas de regresión del sitio
npm run test:images # valida las fotos de producto ya publicadas
npm run site        # genera _site/, el único directorio que se publica
npm run verify      # build + test + test:images
```

Un flujo de GitHub Actions repite estos pasos. En `main` publica `_site/` en GitHub Pages; en ramas y pull requests solo construye y adjunta `_site/` como artefacto descargable para revisión.

## Portada con movimiento

`movimiento.js` anima la portada (sin él la tienda funciona igual): perfumes destacados que rotan sobre la foto (lo más vendido, ofertas y nuevos con foto propia), la cinta de marcas (las 16 con más perfumes; tocar una filtra el catálogo; la arma el build), lo que aparece al bajar, las flechas de las secciones y el salto del carrito. Lo que se mueve solo tiene botón de pausa, y con «reducir movimiento» en el aparato todo queda quieto. Solo se animan `transform` y `opacity` (nada empuja la página) y el script no lee medidas que obliguen a recalcularla.

## Panel

`admin.html` muestra una pantalla a la vez desde el menú lateral (en el celular, desde el botón de arriba): `#inicio` (solo «Hoy»: lo pendiente y accesos rápidos), `#ventas`, `#pedidos`, `#cobros`, `#avisame`, `#perfumes`, `#inventario`, `#compras`, `#costos`, `#ofertas`, `#cupones`, `#clientes`, `#encuesta`, `#estadisticas`, `#catalogo` y `#seguridad`. Lo que comparte sección va en pestañas: `#pedidos/lista` y `#pedidos/nuevo`; `#perfumes/buscar`, `#perfumes/editar` y `#perfumes/fotos`. Los enlaces viejos (`#orders-card`…) abren su sección.

## Diseño y movimiento

Colores del logo (negro, dorado y champán) y movimiento con las reglas de Emil Kowalski, que están en `.claude/skills/` para que Claude Code las aplique siempre: curvas `--ease-out` / `--ease-in-out` / `--ease-drawer`, menos de 300 ms en lo que se usa a cada rato, presionar = escala .97, hover solo con `@media(hover:hover) and (pointer:fine)`, ventanas que entran con escala .96, campos de 16 px en el celular y «reducir movimiento» con fundidos cortos. `npm test` revisa estas reglas en `tienda.css` y `admin.css`.

## Base de datos desde GitHub

- **Actions → «Aplicar script en Supabase»**: corre un archivo de `supabase/migrations/` en una sola operación. «ensayar» lo deshace al final (no cambia nada); «aplicar» lo guarda.
- **Actions → «Respaldo semanal de la tienda»**: cada lunes (o al pedirlo) guarda las tablas en CSV para Excel dentro de un `.7z` cifrado; queda 90 días en la ejecución.
- Secretos (Settings → Secrets and variables → Actions): `SUPABASE_DB_URL` (Supabase → Connect → Session pooler, con la contraseña de la base) y `BACKUP_PASSWORD` (16 letras o más; sin ella no se abre el respaldo).

## Dominio propio

La dirección de la tienda sale de `SITE_URL` en `scripts/lib/seo.mjs`; `node scripts/cambiar-dominio.mjs www.tudominio.com` la cambia en todas las páginas, el mapa del sitio, el panel, Opaco y las pruebas (y `… elitescentsrd.github.io` la devuelve). Pasos:

1. DNS del dominio: `www` tipo CNAME → `elitescentsrd.github.io`; el dominio sin `www`, cuatro registros A → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
2. GitHub → Settings → Pages → Custom domain: `www.tudominio.com` → Save. Cuando la revisión de DNS pase, marcar **Enforce HTTPS**. (Publicando con Actions no hace falta archivo `CNAME`.)
3. `node scripts/cambiar-dominio.mjs www.tudominio.com && npm run build && npm test`, y guardar en `main`. La dirección `elitescentsrd.github.io` sigue funcionando y lleva a la nueva.
4. Supabase → Authentication → URL Configuration: Site URL `https://www.tudominio.com` y en Redirect URLs `https://www.tudominio.com/**` (se puede dejar también la de github.io).
5. Google Search Console (propiedad nueva + `sitemap.xml`), Merchant Center / catálogo de Meta (enlace del archivo de productos), Instagram, WhatsApp Business y el Perfil de Empresa de Google: poner la dirección nueva.

## Fotos de producto

Cada producto tiene su foto individual en `img/productos/<ID de 4 dígitos>-<nombre>.jpg` (900×900). El build las asigna por ID y las declara en el JSON-LD. Una foto subida desde el panel (`image_url` en la base de datos) tiene prioridad sobre la del sitio. Si un producto no tiene foto, se muestra "Foto próximamente". `tools/` contiene herramientas opcionales para regenerar las fotos desde el catálogo en PDF.

## Licencia y contacto

Contenido y marca © Elite Scents RD. Para consultas, escribe por WhatsApp desde el sitio.

## Opaco (anonimización de PDF) · `/opaco/`

Aplicación independiente de la tienda, publicada en `https://elitescentsrd.github.io/opaco/`: detecta datos personales en PDF (nombres, DNI/NIE, teléfonos, correos, direcciones, cuentas bancarias, fechas de nacimiento y nº de la Seguridad Social), permite revisarlos y descarga una copia censurada de verdad (páginas rasterizadas con los recuadros fundidos, sin metadatos, con verificación del resultado). Todo se procesa en el navegador; las librerías (pdf.js, pdf-lib, Tesseract.js con el modelo de español) están en `opaco/vendor/`.

- Páginas: se editan en `src/opaco/*.html` y se montan con `node scripts/opaco-paginas.mjs` (cabecera, pie y CSP comunes).
- Cuentas, créditos y planes: `opaco/js/api.js`. **Versión de demostración**: los datos de las cuentas viven en el `localStorage` del navegador y los pagos son simulados. Para un servicio real hay que sustituir ese archivo por llamadas a un servidor (misma interfaz) y conectar una pasarela de pago.
- Cuenta de prueba (se crea sola en cada navegador): `prueba@opaco.demo` / `PruebaOpaco-2026`.
- Pruebas: `npm run test:opaco` (detector y páginas, incluido en `npm test`) y `npm run test:opaco:e2e` (recorrido completo en Chromium; requiere `playwright-core`).
- Ejemplos e imágenes: `node scripts/opaco-generar-ejemplos.mjs` y `node scripts/opaco-generar-imagenes.mjs`.
