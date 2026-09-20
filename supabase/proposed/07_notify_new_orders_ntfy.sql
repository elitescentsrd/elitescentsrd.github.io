-- OPCIONAL — Aviso al celular de cada pedido nuevo, aunque el panel esté cerrado.
--
-- Cómo funciona: cuando entra un pedido (INSERT en public.orders), la base de datos envía un mensaje a
-- ntfy.sh, un servicio gratuito de notificaciones push. Instalas la app "ntfy" (Android/iPhone), te suscribes
-- a tu tema secreto y te suena el celular con "Nuevo pedido #N".
--
-- PRIVACIDAD: el mensaje solo lleva el número del pedido y el total. No se envía nombre, teléfono, cédula
-- ni dirección de ningún cliente.
--
-- SEGURIDAD: el nombre del tema funciona como una contraseña (quien lo conozca puede leer y enviar avisos).
--   * NO subas este archivo a GitHub con tu tema real. Reemplaza el texto TEMA_SECRETO_AQUI SOLO en el
--     SQL Editor de Supabase, con un valor largo y aleatorio (por ejemplo: elite-pedidos-k7Xq92mZpL4vRt8w).
--   * Si el aviso falla (sin internet, servicio caído), el pedido igual se guarda: el error se ignora.
--
-- Requisitos: la extensión pg_net (Supabase → Database → Extensions → buscar "pg_net" → activar).
-- Es reversible: al final hay una sentencia para quitarlo.

create or replace function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url     := 'https://ntfy.sh/',
      body    := jsonb_build_object(
                   'topic',    'TEMA_SECRETO_AQUI',
                   'title',    'Nuevo pedido #' || new.id,
                   'message',  'Total: ' || coalesce(new.amount, 'por confirmar') || '. Abre el panel de Elite Scents para atenderlo.',
                   'priority', 4,
                   'tags',     jsonb_build_array('shopping_cart')
                 ),
      timeout_milliseconds := 3000
    );
  exception when others then
    -- Nunca bloquear la creación del pedido por un fallo del aviso.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_new_order on public.orders;
create trigger notify_new_order
after insert on public.orders
for each row execute function private.notify_new_order();

-- Para desactivarlo:
--   drop trigger if exists notify_new_order on public.orders;
--   drop function if exists private.notify_new_order();
