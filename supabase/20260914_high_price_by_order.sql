create or replace function private.enforce_high_price_by_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  highest_price numeric;
begin
  select max(replace(replace(price_match[1], ',', ''), '.', '')::numeric)
    into highest_price
  from regexp_matches(new.price, '([0-9][0-9,.]*)', 'g') as price_match;

  if highest_price >= 7000 then
    new.availability := 'encargo';
  end if;

  return new;
end;
$$;

drop trigger if exists products_high_price_by_order on public.products;
create trigger products_high_price_by_order
before insert or update of price, availability on public.products
for each row execute function private.enforce_high_price_by_order();

with parsed as (
  select p.id,
         max(replace(replace(price_match[1], ',', ''), '.', '')::numeric) as highest_price
  from public.products p
  cross join lateral regexp_matches(p.price, '([0-9][0-9,.]*)', 'g') as price_match
  group by p.id
)
update public.products p
set availability = 'encargo',
    updated_at = now()
from parsed
where p.id = parsed.id
  and parsed.highest_price >= 7000
  and p.availability <> 'encargo';