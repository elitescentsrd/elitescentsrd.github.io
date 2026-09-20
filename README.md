# Elite Scents RD

Tienda web de Elite Scents RD: catálogo de fragancias con búsqueda y filtros, alojado en GitHub Pages, y consultas por WhatsApp.

## Tecnología

Sitio estático en HTML, CSS y JavaScript nativo (sin frameworks ni bundler). Node.js se usa solo para generar el catálogo estático durante el build; no hay dependencias npm externas.

## Desarrollo

```bash
npm run build   # genera index.html a partir de src/index.template.html
npm test        # ejecuta las pruebas de regresión del sitio
npm run verify  # build + test
```

Un flujo de GitHub Actions repite `build` y `test` y publica el resultado en GitHub Pages tras cada cambio en `main`.

## Licencia y contacto

Contenido y marca © Elite Scents RD. Para consultas, escribe por WhatsApp desde el sitio.
