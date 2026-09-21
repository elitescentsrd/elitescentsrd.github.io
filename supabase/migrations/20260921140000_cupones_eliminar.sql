-- CUPONES: permitir eliminar cupones que ya se usaron.
--
-- Antes, un cupón usado no se podía eliminar (solo desactivar) y la lista del panel se iba llenando.
-- Con este cambio, al eliminar un cupón también se borra su historial de usos (tabla coupon_redemptions).
-- Los pedidos NO se tocan: siguen guardando el código del cupón (orders.coupon_code) y el descuento aplicado
-- (orders.discount_amount), así que no se pierde ninguna venta ni ningún descuento ya dado.
--
-- Requisito: la migración 20260921130000_cupones.sql ya aplicada. Es seguro ejecutarla más de una vez.
--
-- Para deshacerla (vuelve a impedir eliminar cupones ya usados):
--   alter table public.coupon_redemptions drop constraint coupon_redemptions_coupon_code_fkey;
--   alter table public.coupon_redemptions add constraint coupon_redemptions_coupon_code_fkey
--     foreign key (coupon_code) references public.coupons (code) on update cascade on delete restrict;

do $$
declare
  r record;
begin
  if to_regclass('public.coupon_redemptions') is null or to_regclass('public.coupons') is null then
    raise exception 'Falta la migración de cupones (20260921130000_cupones.sql). Aplícala primero. No se cambió nada.';
  end if;
  -- Se quita la regla anterior (cualquiera que sea su nombre) y se deja una que borra el historial junto con el cupón.
  for r in
    select conname from pg_constraint
    where conrelid = 'public.coupon_redemptions'::regclass and confrelid = 'public.coupons'::regclass and contype = 'f'
  loop
    execute format('alter table public.coupon_redemptions drop constraint %I', r.conname);
  end loop;
  alter table public.coupon_redemptions
    add constraint coupon_redemptions_coupon_code_fkey
    foreign key (coupon_code) references public.coupons (code) on update cascade on delete cascade;
end $$;
