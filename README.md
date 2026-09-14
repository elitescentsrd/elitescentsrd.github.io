# Elite Scents RD

Tienda estática publicada en GitHub Pages desde la raíz de la rama main. El sitio de Sites anterior permanece independiente.

## Administración

Los datos del catálogo están en `catalogo-data-1.js` a `catalogo-data-12.js`. Para modificar precio, tamaño o nombre, edita el objeto correspondiente desde GitHub con una cuenta autorizada; los cambios se publican al actualizar GitHub Pages. Conserva la estructura JavaScript y los campos `name`, `price`, `size`, `gender`, `page` y `slot`. La imagen se recorta de `pages/page-XX.webp` según página y posición. Para agregar productos sin imagen del catálogo se necesita ampliar el modelo de imágenes.

Las consultas y pedidos se reciben por WhatsApp en +1 809 433 3348; no hay carrito, cobro en línea ni base de datos de clientes. GitHub Pages no puede alojar un panel de administración con autenticación de servidor. Nunca coloques tokens personales, contraseñas o claves API en archivos del repositorio ni en JavaScript público.

## Publicación y SEO

Archivo principal `index.html`; estilos `tienda.css`; catálogo `tienda.js`; páginas informativas y catálogo visual independientes. `robots.txt`, `sitemap.xml`, canonical, Open Graph y datos estructurados señalan el dominio GitHub Pages. Para una administración dedicada de productos y pedidos se necesitará un backend con autenticación, autorización y persistencia, configurado fuera de GitHub Pages.
