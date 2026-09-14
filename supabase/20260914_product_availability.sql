-- Adds storefront inventory states managed from the admin panel.
alter table public.products
add column availability text not null default 'disponible'
check (availability in ('disponible','agotado','encargo'));
create index products_availability on public.products(availability) where active;
