
-- Elite Scents RD: customer accounts, secure ordering, admin notifications support,
-- and competitive pricing derived from La Grada 2026 source prices.

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '' check (length(first_name) <= 80),
  last_name text not null default '' check (length(last_name) <= 120),
  cedula text not null default '' check (length(cedula) <= 30),
  phone text not null default '' check (length(phone) <= 40),
  address text not null default '' check (length(address) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;

drop policy if exists "Customers read own profile" on public.customer_profiles;
create policy "Customers read own profile"
on public.customer_profiles for select to authenticated
using (user_id = auth.uid() or (select private.is_store_admin()));

drop policy if exists "Customers insert own profile" on public.customer_profiles;
create policy "Customers insert own profile"
on public.customer_profiles for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Customers update own profile" on public.customer_profiles;
create policy "Customers update own profile"
on public.customer_profiles for update to authenticated
using (user_id = auth.uid() or (select private.is_store_admin()))
with check (user_id = auth.uid() or (select private.is_store_admin()));

alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists shipping_address text not null default '',
  add column if not exists cedula text not null default '',
  add column if not exists items_json jsonb not null default '[]'::jsonb,
  add column if not exists total_amount integer not null default 0,
  add column if not exists estimated_delivery text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status = any (array['nuevo'::text,'confirmado'::text,'preparando'::text,'enviado'::text,'entregado'::text,'cancelado'::text]));

drop policy if exists "Customers read own orders" on public.orders;
create policy "Customers read own orders"
on public.orders for select to authenticated
using (user_id = auth.uid() or (select private.is_store_admin()));

create table if not exists public.product_costs (
  product_id bigint primary key references public.products(id) on delete cascade,
  source text not null default 'La Grada Perfumería - Catálogo Oficial 2026',
  source_page integer,
  old_public_price text not null,
  supplier_cost_min integer not null check (supplier_cost_min >= 0),
  supplier_cost_max integer not null check (supplier_cost_max >= supplier_cost_min),
  inbound_shipping_estimate integer not null default 200 check (inbound_shipping_estimate >= 0),
  updated_at timestamptz not null default now()
);

alter table public.product_costs enable row level security;

drop policy if exists "Admins read product costs" on public.product_costs;
create policy "Admins read product costs"
on public.product_costs for select to authenticated
using ((select private.is_store_admin()));

drop policy if exists "Admins manage product costs" on public.product_costs;
create policy "Admins manage product costs"
on public.product_costs for all to authenticated
using ((select private.is_store_admin()))
with check ((select private.is_store_admin()));

with parsed as (
  select
    p.id,
    p.page,
    p.price,
    min(replace(m[1], ',', '')::integer) - 1200 as supplier_min,
    max(replace(m[1], ',', '')::integer) - 1200 as supplier_max
  from public.products p
  cross join lateral regexp_matches(p.price, '([0-9][0-9,]*)', 'g') as m
  group by p.id, p.page, p.price
)
insert into public.product_costs
  (product_id, source_page, old_public_price, supplier_cost_min, supplier_cost_max, inbound_shipping_estimate, updated_at)
select id, page, price, greatest(supplier_min,0), greatest(supplier_max,0), 200, now()
from parsed
on conflict (product_id) do update
set source_page = excluded.source_page,
    old_public_price = excluded.old_public_price,
    supplier_cost_min = excluded.supplier_cost_min,
    supplier_cost_max = excluded.supplier_cost_max,
    inbound_shipping_estimate = excluded.inbound_shipping_estimate,
    updated_at = now();

-- Competitive pricing strategy:
-- supplier price + RD$200 estimated inbound shipping + profit.
-- Profit is the greater of RD$600 or ~15% of supplier cost,
-- rounded to RD$50 and capped at RD$1,000.
-- This never raises prices above the previous +RD$1,200 structure.
with parsed as (
  select
    p.id,
    replace((regexp_match(p.price, '([0-9][0-9,]*)'))[1], ',', '')::integer as current_price
  from public.products p
  where p.price not like '%/%'
),
calc as (
  select
    id,
    current_price,
    greatest(current_price - 1200, 0) as supplier_cost
  from parsed
),
priced as (
  select
    id,
    current_price,
    supplier_cost,
    least(
      current_price,
      supplier_cost + 200 +
      least(1000, greatest(600, (round((supplier_cost * 0.15) / 50.0) * 50)::integer))
    ) as new_price
  from calc
)
update public.products p
set price = 'RD$' || to_char(priced.new_price, 'FM999,999,990'),
    updated_at = now()
from priced
where p.id = priced.id
  and priced.new_price > 0;

-- Three products have multiple size/price variants.
update public.products set price='RD$3,150 / RD$3,750', updated_at=now() where id=28;
update public.products set price='RD$3,450 / RD$3,750', updated_at=now() where id=29;
update public.products set price='RD$2,750 / RD$3,600', updated_at=now() where id=71;

create or replace function public.place_customer_order(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.customer_profiles%rowtype;
  v_order_id bigint;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id bigint;
  v_qty integer;
  v_requested_price integer;
  v_requested_size text;
  v_allowed_prices integer[];
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_summary text := '';
begin
  if v_user is null then
    raise exception 'Debes iniciar sesión para ordenar.';
  end if;

  select * into v_profile
  from public.customer_profiles
  where user_id = v_user;

  if not found then
    raise exception 'Completa tus datos antes de ordenar.';
  end if;

  if length(trim(v_profile.first_name)) < 2
     or length(trim(v_profile.last_name)) < 2
     or length(trim(v_profile.phone)) < 7
     or length(trim(v_profile.address)) < 5 then
    raise exception 'Completa nombre, apellidos, teléfono y dirección.';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 20 then
    raise exception 'El carrito debe tener entre 1 y 20 productos.';
  end if;

  insert into public.orders (
    user_id, customer_name, phone, shipping_address, cedula,
    items, amount, status, notes, items_json, total_amount, updated_at
  )
  values (
    v_user,
    trim(v_profile.first_name || ' ' || v_profile.last_name),
    trim(v_profile.phone),
    trim(v_profile.address),
    trim(v_profile.cedula),
    'Procesando carrito…',
    '',
    'nuevo',
    '',
    '[]'::jsonb,
    0,
    now()
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id','')::bigint;
    v_qty := coalesce(nullif(v_item->>'qty','')::integer, 1);
    v_requested_price := nullif(v_item->>'unit_price','')::integer;
    v_requested_size := left(coalesce(v_item->>'size',''), 60);

    if v_product_id is null or v_qty < 1 or v_qty > 10 then
      raise exception 'Hay un producto inválido en el carrito.';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id and active = true;

    if not found then
      raise exception 'Uno de los perfumes ya no está disponible.';
    end if;

    if v_product.availability = 'agotado' then
      raise exception 'El perfume "%" está agotado.', v_product.name;
    end if;

    select array_agg(replace(m[1], ',', '')::integer order by ord)
    into v_allowed_prices
    from regexp_matches(v_product.price, '([0-9][0-9,]*)', 'g') with ordinality as x(m, ord);

    if v_requested_price is null then
      v_requested_price := v_allowed_prices[1];
    end if;

    if v_allowed_prices is null or not (v_requested_price = any(v_allowed_prices)) then
      raise exception 'El precio del perfume "%" cambió. Actualiza el carrito.', v_product.name;
    end if;

    if v_requested_size = '' then
      v_requested_size := v_product.size;
    end if;

    v_total := v_total + (v_requested_price * v_qty);
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'brand', v_product.brand,
        'size', v_requested_size,
        'unit_price', v_requested_price,
        'qty', v_qty,
        'availability', v_product.availability
      )
    );
    v_summary := v_summary ||
      case when v_summary = '' then '' else E'\n' end ||
      v_qty || '× ' || v_product.name || ' · ' || v_requested_size ||
      ' · RD$' || to_char(v_requested_price, 'FM999,999,990');
  end loop;

  update public.orders
  set items = left(v_summary, 2000),
      items_json = v_items,
      total_amount = v_total,
      amount = 'RD$' || to_char(v_total, 'FM999,999,990'),
      updated_at = now()
  where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'total_amount', v_total,
    'status', 'nuevo'
  );
exception
  when others then
    if v_order_id is not null then
      delete from public.orders where id = v_order_id;
    end if;
    raise;
end;
$$;

revoke all on function public.place_customer_order(jsonb) from public;
grant execute on function public.place_customer_order(jsonb) to authenticated;
