-- Migración idempotente: place_customer_order solo puede ejecutarla un usuario con sesión.
--
-- Estado observado en producción (20-sep-2026, con la clave pública y sin sesión):
--   POST /rest/v1/rpc/place_customer_order  ->  HTTP 400 {"code":"P0001","message":"Debes iniciar sesión para ordenar."}
-- Es decir, anon todavía tiene EXECUTE y solo lo frena la validación interna de auth.uid().
-- Tras aplicar esta migración la misma llamada debe responder 401/403 (permission denied).
--
-- Solo cambia permisos; no toca la lógica de la función. Si la función no existe,
-- no falla (por ejemplo en un proyecto nuevo).
do $$
begin
  if to_regprocedure('public.place_customer_order(jsonb)') is not null then
    revoke execute on function public.place_customer_order(jsonb) from public, anon;
    grant  execute on function public.place_customer_order(jsonb) to authenticated;
  else
    raise notice 'public.place_customer_order(jsonb) no existe; no se cambió ningún permiso.';
  end if;
end $$;

-- Después de aplicar:
--   1. node scripts/check-supabase-security.mjs --strict        (visitante -> rechazado por permiso)
--   2. Hacer un pedido de prueba con una cuenta de cliente de PRUEBA (no con datos reales) y confirmar que se crea.
