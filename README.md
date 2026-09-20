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

## Licencia y contacto

Contenido y marca © Elite Scents RD. Para consultas, escribe por WhatsApp desde el sitio.
