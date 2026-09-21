-- OFERTAS por evento.
--
-- Diseño: cuando un perfume entra en oferta, su columna price pasa a ser el PRECIO DE OFERTA y el precio normal se
-- guarda en original_price. Así todo lo que ya funciona (carrito, pedidos, la RPC place_customer_order que recalcula el
-- precio en el servidor, WhatsApp) cobra el precio de oferta sin tocar nada más. Al terminar la oferta, price vuelve
-- a original_price y original_price queda en null.
--
--   original_price  precio anterior (mismo formato que price, p. ej. 'RD$4,500' o 'RD$3,550 / RD$4,150')
--   offer_label     nombre del evento ('Día de las Madres')
--   offer_ends_at   cuándo termina (opcional); public.expire_offers() la revierte sola cada 5 minutos con pg_cron
--
-- Es idempotente: puedes ejecutarla más de una vez.

alter table public.products
  add column if not exists original_price text check (original_price is null or length(original_price) <= 70),
  add column if not exists offer_label    text check (offer_label is null or length(offer_label) <= 60),
  add column if not exists offer_ends_at  timestamptz;

create or replace function private.price_amounts(p text)
returns numeric[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select replace(m[1], ',', '')::numeric from regexp_matches(coalesce(p, ''), '([0-9][0-9,]*)', 'g') as m), '{}'::numeric[])
$$;

-- Integridad: una oferta debe tener el mismo número de presentaciones que el precio anterior y ser menor en todas.
create or replace function private.products_offer_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  offer numeric[];
  original numeric[];
begin
  if new.original_price is null then
    new.offer_label := null;
    new.offer_ends_at := null;
    return new;
  end if;
  offer := private.price_amounts(new.price);
  original := private.price_amounts(new.original_price);
  if coalesce(array_length(offer, 1), 0) = 0 or array_length(offer, 1) is distinct from array_length(original, 1) then
    raise exception 'El precio de oferta debe tener las mismas presentaciones que el precio anterior (%).', new.original_price;
  end if;
  for i in 1 .. array_length(offer, 1) loop
    if offer[i] >= original[i] then
      raise exception 'El precio de oferta (%) debe ser menor que el precio anterior (%).', new.price, new.original_price;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists products_offer_guard on public.products;
create trigger products_offer_guard
before insert or update of price, original_price, offer_label, offer_ends_at on public.products
for each row execute function private.products_offer_guard();

-- Termina las ofertas vencidas: devuelve price a su valor normal.
create or replace function public.expire_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.products
     set price = original_price, original_price = null, offer_label = null, offer_ends_at = null
   where original_price is not null and offer_ends_at is not null and offer_ends_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.expire_offers() from public, anon, authenticated;

-- Programación automática cada 5 minutos (necesita la extensión pg_cron: Database -> Extensions -> pg_cron).
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'elite-expire-offers') then
    perform cron.unschedule('elite-expire-offers');
  end if;
  perform cron.schedule('elite-expire-offers', '*/5 * * * *', 'select public.expire_offers()');
exception when others then
  raise notice 'pg_cron no está disponible (%). Actívalo en Database -> Extensions y vuelve a ejecutar este bloque; mientras tanto termina las ofertas desde el panel.', sqlerrm;
end;
$$;

-- Comprobación:
--   select id, name, price, original_price, offer_label, offer_ends_at from public.products where original_price is not null;
--   select jobname, schedule, active from cron.job where jobname = 'elite-expire-offers';
