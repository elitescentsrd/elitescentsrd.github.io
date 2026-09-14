alter table public.products
  add column if not exists brand text not null default '',
  add column if not exists notes_top text[] not null default '{}',
  add column if not exists notes_heart text[] not null default '{}',
  add column if not exists notes_base text[] not null default '{}',
  add column if not exists gallery_urls text[] not null default '{}',
  add column if not exists description text not null default '';

alter table public.products
  add constraint products_brand_length check (length(brand) <= 120),
  add constraint products_description_length check (length(description) <= 1200),
  add constraint products_gallery_limit check (cardinality(gallery_urls) <= 3),
  add constraint products_notes_top_limit check (cardinality(notes_top) <= 12),
  add constraint products_notes_heart_limit check (cardinality(notes_heart) <= 12),
  add constraint products_notes_base_limit check (cardinality(notes_base) <= 12);

update public.products set brand = case
  when name ~* '^(212|Carolina Herrera)' then 'Carolina Herrera'
  when name ~* '^360 ' then 'Perry Ellis'
  when name ~* '^(9 AM|9 PM|9AM|9PM|Afnan)' then 'Afnan'
  when name ~* '^(Acqua di Giò|Armani)' then 'Giorgio Armani'
  when name ~* '^Al Haramain' then 'Al Haramain'
  when name ~* '^Ariana ' then 'Ariana Grande'
  when name ~* '^Ana Abiyedh' then 'Lattafa'
  when name ~* '^Blue Chanel' then 'Chanel'
  when name ~* '^Bond ' then 'Bond No. 9'
  when name ~* '^Britney ' then 'Britney Spears'
  when name ~* '^Calvin ' then 'Calvin Klein'
  when name ~* '^Dolce ' then 'Dolce & Gabbana'
  when name ~* '^Game ' then 'Game of Spades'
  when name ~* '^Issey ' then 'Issey Miyake'
  when name ~* '^Jean Lowe' then 'Maison Alhambra'
  when name ~* '^JPG ' then 'Jean Paul Gaultier'
  when name ~* '^Maison ' then 'Maison Alhambra'
  when name ~* '^(Mont Blanc|Montblanc)' then 'Montblanc'
  when name ~* '^Paco ' then 'Paco Rabanne'
  when name ~* '^Polo ' then 'Ralph Lauren'
  when name ~* '^Set ' then 'Sets'
  when name ~* '^Spicebomb' then 'Viktor & Rolf'
  when name ~* '^(YSL|Yves Saint Laurent)' then 'Yves Saint Laurent'
  when name ~* '^Yara ' then 'Lattafa'
  else split_part(name,' ',1)
end
where brand = '';

create index if not exists products_brand_active on public.products (brand) where active;
create index if not exists products_notes_top_gin on public.products using gin (notes_top);
create index if not exists products_notes_heart_gin on public.products using gin (notes_heart);
create index if not exists products_notes_base_gin on public.products using gin (notes_base);