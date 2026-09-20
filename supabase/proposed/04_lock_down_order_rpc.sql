-- PROPUESTA — segura de aplicar tal cual (solo cambia permisos, no la lógica
-- de la función). Ya recomendada por la auditoría anterior: la función
-- place_customer_order(jsonb) es SECURITY DEFINER y hoy tiene EXECUTE
-- disponible para anon y authenticated; una llamada anónima ya es rechazada
-- porque la función valida auth.uid(), pero conviene revocar el permiso de
-- forma explícita en vez de depender solo de esa validación interna.

revoke execute on function public.place_customer_order(jsonb) from public, anon;
grant execute on function public.place_customer_order(jsonb) to authenticated;

-- Después de aplicar, vuelve a probar:
-- 1. Un pedido autenticado normal (debe seguir funcionando).
-- 2. Una llamada anónima directa a la RPC (debe fallar por falta de permiso,
--    no solo por la validación de auth.uid()).
