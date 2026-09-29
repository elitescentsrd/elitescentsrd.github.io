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
