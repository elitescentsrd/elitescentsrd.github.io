# Elite Scents RD

Sitio público alojado en GitHub Pages. El sitio anterior de Sites permanece independiente.

## Estado

El proyecto Supabase `ozowziumksrudrotulll` está conectado. La base contiene 420 perfumes. El catálogo se pre-renderiza desde Supabase durante el build y el navegador consulta una versión actualizada con un timeout de 8 segundos. Si la consulta falla, la tienda conserva la última versión estática publicada y muestra un aviso claro. El panel está en `/admin.html`. El primer usuario administrador ya se creó, confirmó su correo y recibió acceso. Puede iniciar sesión en `/admin.html` con la contraseña que configuró en Supabase.

## Activación segura del backend

1. **Ya realizado.** Proyecto gratuito creado, `supabase/schema.sql`, `supabase/20260914_private_admin_check.sql`, `supabase/20260914_product_images.sql` y `supabase/20260914_product_availability.sql` aplicados, 420 perfumes importados. Los archivos representan el historial reproducible de la base; no los ejecutes de nuevo en este proyecto.
2. **Ya realizado.** Usuario administrador creado y correo confirmado. Recomendado: desactivar registro público en Authentication Settings, pues el panel no lo necesita.
3. **Ya realizado.** La cuenta autorizada se registró en `public.admin_users`. Para dar acceso a otra persona, revisa su identidad antes de añadir su ID de Auth a esa tabla.
4. **Ya realizado.** La URL y la clave pública están en `supabase-config.js`; esa clave está diseñada para el navegador y las reglas RLS protegen los datos. **Jamás** coloques la `secret` o `service_role` en GitHub, HTML o JavaScript.
5. Abre `https://elitescentsrd.github.io/admin.html`, inicia sesión y comprueba que puedes editar un producto y registrar un pedido. Verifica desde una ventana privada que el catálogo público solo ve productos activos y que los pedidos no son accesibles sin iniciar sesión.

GitHub Pages solo sirve HTML/CSS/JS; la autorización ocurre en Supabase Auth y Postgres RLS. **No uses pedidos de prueba con datos reales hasta comprobar las políticas.** El panel registra manualmente los pedidos confirmados por WhatsApp; no lee conversaciones ni procesa pagos. Productos con `page` y `slot` usan recortes del catálogo original; productos nuevos pueden usar una URL HTTPS o subir fotos JPG, PNG o WebP de hasta 3 MB. Solo administradores pueden subir fotos al bucket público `product-images`. Puedes cambiar precios, marcar productos como Disponible, Agotado o Solo por encargo, y eliminar productos o pedidos desde el panel con confirmación. Una regla de base de datos fuerza automáticamente `encargo` cuando el precio publicado es de RD$7,000 o más; por debajo de ese monto el estado se administra manualmente. Las fotos previamente subidas no se borran automáticamente cuando eliminas un producto; revisa el espacio de Storage periódicamente.

## Seguridad y datos

La tabla `admin_users` controla la membresía y solo puede modificarse con permisos de administrador del proyecto Supabase. La tabla `orders` guarda nombre, teléfono, productos, estado y notas; solo los usuarios administradores pueden leer y editar registros. El sitio público no almacena tarjetas ni permite enviar pedidos a la base de datos. Limita las cuentas con acceso al proyecto y usa autenticación multifactor en tus cuentas de GitHub y Supabase.

## SEO y publicación

`index.html` contiene metadatos, canonical, Open Graph y datos estructurados. `robots.txt` y `sitemap.xml` referencian el dominio GitHub Pages. El catálogo visual está en `catalogo.html`. Los precios y la disponibilidad deben confirmarse antes de cerrar la venta.

## Build estático del catálogo

El proyecto usa Node.js 20 sin dependencias externas. `scripts/build-catalog.mjs` consulta los productos públicos en Supabase, lee `src/index.template.html` y genera `index.html` con:

- Las 420 tarjetas visibles en HTML estático.
- Un bloque `Product` JSON-LD por producto.
- Una copia JSON de los productos para que los filtros funcionen inmediatamente.

Ejecuta `npm run build` antes de revisar cambios locales. El workflow `.github/workflows/pages.yml` repite el build y publica el resultado en GitHub Pages después de cada push a `main`. También puede ejecutarse manualmente.

## Validación de datos estructurados

1. Publica primero la rama en una URL de prueba o abre un pull request.
2. Entra a https://search.google.com/test/rich-results.
3. Selecciona **URL**, pega la dirección pública y ejecuta la prueba.
4. Revisa los elementos **Product snippets** detectados. Una advertencia no siempre bloquea el resultado; los errores rojos sí deben corregirse antes del merge.
5. Como comprobación adicional, abre el código fuente de la página y busca `"@type":"Product"`: debe aparecer sin depender de JavaScript.
