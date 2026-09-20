# Migraciones propuestas — revisar antes de aplicar

Estos archivos **no se ejecutan automáticamente** (no están en `supabase/`, la
carpeta que sí forma parte del historial aplicado). Son una propuesta
reconstruida a partir de lo que el frontend (`admin.js`, `customer.js`)
realmente necesita, comparado con lo que hay versionado en `supabase/*.sql`.
No tengo acceso al proyecto Supabase real, así que no pude confirmar el
esquema en vivo con `supabase db diff`; revisa cada archivo en el Editor SQL
de Supabase antes de ejecutarlo, uno por uno.

Orden sugerido:

1. `01_orders_online_columns_and_status.sql` — seguro de aplicar tal cual: usa
   `if not exists` en todo, así que no falla si esas columnas ya existen en
   producción (lo más probable, dado que `admin.js` ya las usa).
2. `02_customer_profiles.sql` — seguro de aplicar si la tabla no existe
   todavía. Si ya existe con otro nombre de columna, ajusta antes de correr.
3. `04_lock_down_order_rpc.sql` — seguro de aplicar: solo cambia permisos
   (`REVOKE`/`GRANT`), no toca la lógica de la función.
4. `05_storage_admin_delete_update.sql` — seguro de aplicar si no existen ya
   políticas equivalentes.
5. `03_place_customer_order_RPC_referencia.sql` — **NO ejecutar directamente.**
   Es una reconstrucción de referencia de la función `place_customer_order`,
   escrita solo a partir de cómo la llama `customer.js`. La auditoría anterior
   confirmó que la función real ya existe, ya valida `auth.uid()` y ya
   recalcula precios en servidor — probablemente mejor que esta plantilla.
   Antes de tocar nada, ejecuta en el SQL Editor:
   `select prosrc from pg_proc where proname = 'place_customer_order';`
   Si devuelve una función, consérvala y usa este archivo solo para comparar
   ideas (por ejemplo, si te falta la parte de recalcular precio). Si no
   devuelve nada (la función no existe de verdad y los pedidos autenticados
   están fallando en producción), entonces sí puedes partir de esta plantilla,
   revisándola línea por línea primero.
6. `06_fill_missing_sizes.sql` — plantilla (todo comentado) para completar el
   tamaño de 3 productos. Confirma cada valor antes de descomentar.

## Cómo crear una línea base real del esquema (pendiente de hacer con acceso a Supabase)

Lo versionado aquí no representa por completo el backend en producción. Para
poder reconstruirlo y auditarlo desde Git, exporta el esquema real **sin datos ni
secretos** desde una computadora con la CLI de Supabase iniciada con tu cuenta:

```bash
supabase login
supabase link --project-ref <REFERENCIA_DEL_PROYECTO>   # la referencia está en tus notas privadas
supabase db dump --schema public,private,storage --file supabase/baseline/20260920_schema_baseline.sql
supabase db dump --role-only --file supabase/baseline/20260920_roles.sql   # opcional
```

Revisa el archivo resultante (busca claves, correos o datos de clientes antes de
subirlo), colócalo en `supabase/baseline/` y a partir de ahí crea cada cambio
nuevo como una migración incremental e idempotente (`if not exists`,
`drop policy if exists ...`). Cuando `supabase db diff` no muestre diferencias
entre la base real y `supabase/`, la carpeta `proposed/` puede eliminarse.

Comprobaciones de seguridad recomendadas tras aplicar `04_lock_down_order_rpc.sql`:
una llamada anónima a `rpc/place_customer_order` debe responder 401/403 (hoy
responde 400 porque el permiso `EXECUTE` de `anon` sigue activo), y `orders` y
`admin_users` deben seguir devolviendo 401 sin sesión.
