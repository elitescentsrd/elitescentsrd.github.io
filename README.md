# Elite Scents RD

Sitio público alojado en GitHub Pages. El sitio anterior de Sites permanece independiente.

## Estado

El proyecto Supabase `ozowziumksrudrotulll` está conectado. La base contiene 420 perfumes y el sitio público carga productos visibles desde ella; si falla la conexión, aún existe una copia local del catálogo. El panel está en `/admin.html`. Falta crear y autorizar el primer usuario administrador para poder iniciar sesión.

## Activación segura del backend

1. **Ya realizado.** Proyecto gratuito creado, `supabase/schema.sql` y `supabase/20260914_private_admin_check.sql` aplicados, 420 perfumes importados. Ambos archivos representan el historial reproducible de la base; no los ejecutes de nuevo en este proyecto.
2. En **Authentication → Users**, crea tu usuario administrador con correo y contraseña de acceso. Confirma el correo si Supabase lo solicita. Recomendado: desactivar registro público en Authentication Settings, pues el panel no lo necesita.
3. En SQL Editor, ejecuta: `insert into public.admin_users(user_id) select id from auth.users where email = 'TU_CORREO_ADMIN' on conflict do nothing;` sustituyendo el correo por el tuyo. Comprueba que inserta exactamente una fila.
4. **Ya realizado.** La URL y la clave pública están en `supabase-config.js`; esa clave está diseñada para el navegador y las reglas RLS protegen los datos. **Jamás** coloques la `secret` o `service_role` en GitHub, HTML o JavaScript.
5. Abre `https://elitescentsrd.github.io/admin.html`, inicia sesión y comprueba que puedes editar un producto y registrar un pedido. Verifica desde una ventana privada que el catálogo público solo ve productos activos y que los pedidos no son accesibles sin iniciar sesión.

GitHub Pages solo sirve HTML/CSS/JS; la autorización ocurre en Supabase Auth y Postgres RLS. **No uses pedidos de prueba con datos reales hasta comprobar las políticas.** El panel registra manualmente los pedidos confirmados por WhatsApp; no lee conversaciones ni procesa pagos. Productos con `page` y `slot` usan recortes del catálogo original; productos nuevos pueden usar una URL HTTPS de imagen. No hay carga de archivos implementada.

## Seguridad y datos

La tabla `admin_users` controla la membresía y solo puede modificarse con permisos de administrador del proyecto Supabase. La tabla `orders` guarda nombre, teléfono, productos, estado y notas; solo los usuarios administradores pueden leer y editar registros. El sitio público no almacena tarjetas ni permite enviar pedidos a la base de datos. Limita las cuentas con acceso al proyecto y usa autenticación multifactor en tus cuentas de GitHub y Supabase.

## SEO y publicación

`index.html` contiene metadatos, canonical, Open Graph y datos estructurados. `robots.txt` y `sitemap.xml` referencian el dominio GitHub Pages. El catálogo visual está en `catalogo.html`. Los precios y la disponibilidad deben confirmarse antes de cerrar la venta.
