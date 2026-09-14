-- Keep the privileged membership check outside the exposed public API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create function private.is_store_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admin_users where user_id = (select auth.uid())) $$;
revoke all on function private.is_store_admin() from public, anon;
grant execute on function private.is_store_admin() to authenticated;
drop policy "Admins read catalogue" on public.products;
drop policy "Admins insert catalogue" on public.products;
drop policy "Admins update catalogue" on public.products;
drop policy "Admins delete catalogue" on public.products;
drop policy "Admins read orders" on public.orders;
drop policy "Admins insert orders" on public.orders;
drop policy "Admins update orders" on public.orders;
drop policy "Admins delete orders" on public.orders;
create policy "Admins read catalogue" on public.products for select to authenticated using ((select private.is_store_admin()));
create policy "Admins insert catalogue" on public.products for insert to authenticated with check ((select private.is_store_admin()));
create policy "Admins update catalogue" on public.products for update to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
create policy "Admins delete catalogue" on public.products for delete to authenticated using ((select private.is_store_admin()));
create policy "Admins read orders" on public.orders for select to authenticated using ((select private.is_store_admin()));
create policy "Admins insert orders" on public.orders for insert to authenticated with check ((select private.is_store_admin()));
create policy "Admins update orders" on public.orders for update to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
create policy "Admins delete orders" on public.orders for delete to authenticated using ((select private.is_store_admin()));
drop function public.is_store_admin();
