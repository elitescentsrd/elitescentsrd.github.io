-- PROPUESTA — revisar en el SQL Editor de Supabase antes de ejecutar.
--
-- admin.js ya lee/escribe o.cedula, o.shipping_address, o.estimated_delivery
-- y o.updated_at sobre /rest/v1/orders, y el <select> de estado del panel
-- ofrece 'preparando' y 'enviado'. Ninguna de esas columnas ni esos dos
-- valores existen en supabase/schema.sql, así que o el proyecto real ya
-- tiene estos cambios aplicados manualmente (lo más probable) o el botón
-- "Guardar" del panel está fallando hoy en producción. Este archivo usa
-- "if not exists" / DO blocks para poder ejecutarse sin riesgo aunque la
-- base ya tenga estas columnas.

alter table public.orders
  add column if not exists estimated_delivery text check (estimated_delivery is null or length(estimated_delivery) <= 120),
  add column if not exists cedula text check (cedula is null or length(cedula) <= 30),
  add column if not exists shipping_address text check (shipping_address is null or length(shipping_address) <= 500),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_status_check'
  ) then
    alter table public.orders drop constraint orders_status_check;
  end if;
end $$;

alter table public.orders
  add constraint orders_status_check
  check (status in ('nuevo','confirmado','preparando','enviado','entregado','cancelado'));

create or replace function private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon;
grant execute on function private.touch_updated_at() to authenticated;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
before update on public.orders
for each row execute function private.touch_updated_at();
