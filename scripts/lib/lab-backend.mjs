// Montaje del laboratorio: una copia del backend de Supabase con PostgreSQL embebido (PGlite) —las MISMAS reglas (RLS),
// funciones y permisos de las migraciones— con datos de ejemplo (un administrador, una clienta «víctima» y un «atacante»).
// Lo usan el laboratorio automático (lab-ataques-sql.mjs) y la consola interactiva (laboratorio.mjs). No toca Supabase ni
// la tienda real; no necesita ninguna clave.
import { readFile } from 'node:fs/promises';
import { nuevaBase } from './base-prueba-sql.mjs';

export const IDS = {
  ADMIN: '00000000-0000-0000-0000-000000000099',
  VICTIMA: '11111111-1111-1111-1111-111111111111',
  ATACANTE: '22222222-2222-2222-2222-222222222222',
};

export async function montarLaboratorio(PGlite) {
  const M = 'supabase/migrations/';
  const leer = f => readFile(M + f, 'utf8');
  // nuevaBase ya trae: roles anon/authenticated, auth.uid(), administrador, products+orders con RLS, ofertas, cupones,
  // protección de pedidos y encuesta. Encima aplicamos el resto que define la seguridad del backend de hoy.
  const db = await nuevaBase(PGlite);
  // Stubs de vault/net (publicación automática) para que las migraciones que los usan apliquen igual que en Supabase.
  await db.exec(`create schema if not exists vault; create table if not exists vault.secrets_stub (name text, secret text);
    create or replace view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_stub;
    create schema if not exists net; create table if not exists net.calls (id serial primary key, url text, headers jsonb, body jsonb);
    create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
      returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;`);
  for (const f of ['20260921122000_recuperacion_identidad.sql', '20260930120000_funciones_y_perfumes_nuevos.sql', '20261003120000_estadisticas_y_publicacion.sql',
    '20261003180000_lineas_de_pedido_y_existencias.sql', '20261007120000_mensajes_y_resenas.sql', '20261110200000_dos_precios.sql', '20261110230000_contado_con_cupon.sql']) {
    await db.exec(await leer(f));
  }
  await db.exec(`insert into vault.secrets_stub values ('github_publish_token', 'tok-prueba') on conflict do nothing;`);

  // place_customer_order real vive en Supabase (no en el repositorio). Aquí ponemos una versión fiel que SIEMPRE recalcula
  // el precio desde la base y jamás confía en el unit_price que manda el navegador: así el laboratorio prueba la regla de
  // oro de la tienda («nunca confiar en el precio del cliente»).
  await db.exec(`create or replace function public.place_customer_order(p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $f$
    declare v_txt text := ''; v_total numeric := 0; it jsonb; p public.products; v_id bigint; v_i smallint; v_prof public.customer_profiles;
    begin
      if auth.uid() is null then raise exception 'Debes iniciar sesión para ordenar.' using errcode = '28000'; end if;
      select * into v_prof from public.customer_profiles where user_id = auth.uid();
      if v_prof is null or coalesce(v_prof.cedula,'') = '' then raise exception 'Completa tu perfil antes de pedir.'; end if;
      for it in select * from jsonb_array_elements(p_items) loop
        select * into p from public.products where id = (it ->> 'product_id')::bigint and active;
        if p.id is null then raise exception 'Uno de los productos ya no está disponible.'; end if;
        v_i := coalesce(private.size_index(p.size, it ->> 'size'), 0);
        v_total := v_total + private.price_at(p.price, v_i) * greatest(1, least(99, coalesce((it ->> 'qty')::int, 1)));
        v_txt := v_txt || greatest(1, least(99, coalesce((it ->> 'qty')::int, 1))) || 'x ' || p.name || case when coalesce(it ->> 'size','') <> '' then ' (' || (it ->> 'size') || ')' else '' end || E'\\n';
      end loop;
      insert into public.orders (customer_name, phone, items, amount, user_id, cedula, notes)
        values (trim(v_prof.first_name || ' ' || v_prof.last_name), v_prof.phone, btrim(v_txt, E'\\n'), 'RD$' || to_char(v_total, 'FM999,999,999'), auth.uid(), v_prof.cedula, 'Pedido web.') returning id into v_id;
      return jsonb_build_object('order_id', v_id);
    end $f$;
    revoke execute on function public.place_customer_order(jsonb) from public, anon; grant execute on function public.place_customer_order(jsonb) to authenticated;`);

  // Modelo de aislamiento entre clientes (en Supabase real esto ya existe; aquí lo declaramos igual para comprobar que un
  // cliente solo ve LO SUYO). customer_profiles con RLS y permiso a authenticated: así quien filtra es la política, no la
  // falta de permiso (un visitante sin cuenta sí queda sin permiso, que es lo correcto).
  await db.exec(`alter table public.customer_profiles enable row level security;
    grant select, insert, update on public.customer_profiles to authenticated;
    drop policy if exists "Cliente lee sus pedidos" on public.orders;
    create policy "Cliente lee sus pedidos" on public.orders for select to authenticated using (user_id = (select auth.uid()));
    drop policy if exists "Cliente lee su perfil" on public.customer_profiles;
    create policy "Cliente lee su perfil" on public.customer_profiles for select to authenticated using (user_id = (select auth.uid()));
    drop policy if exists "Cliente edita su perfil" on public.customer_profiles;
    create policy "Cliente edita su perfil" on public.customer_profiles for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));`);

  // admin_list_customers(): en Supabase lee la lista de clientes desde auth.users. Aquí ponemos una versión fiel a su
  // SEGURIDAD (solo el administrador recibe datos; cualquier otro recibe vacío), sin arrastrar toda la tabla de usuarios.
  await db.exec(`create or replace function public.admin_list_customers() returns setof public.customer_profiles
      language sql security definer set search_path = '' as $$
      select * from public.customer_profiles where (select private.is_store_admin()) $$;
    revoke all on function public.admin_list_customers() from public, anon;
    grant execute on function public.admin_list_customers() to authenticated;`);

  // Datos de ejemplo: un administrador, una clienta (Ana, la «víctima») y un «atacante», con un pedido, un costo y un cupón.
  await db.exec(`insert into auth.users (id, email) values ('${IDS.ADMIN}','jefe@tienda.do'),('${IDS.VICTIMA}','ana@correo.do'),('${IDS.ATACANTE}','malo@correo.do');
    insert into public.admin_users values ('${IDS.ADMIN}');
    insert into public.customer_profiles (user_id, first_name, last_name, cedula, phone, address) values
      ('${IDS.VICTIMA}','Ana','Pérez','001-1234567-8','8095551111','Calle Luna 1'),
      ('${IDS.ATACANTE}','Malo','Hacker','002-7654321-0','8295552222','Calle Sol 2');
    insert into public.orders (customer_name, phone, items, amount, status, user_id, cedula) values
      ('Ana Pérez','8095551111','1x Rasasi Hawas Fire Men','RD$4,050','entregado','${IDS.VICTIMA}','001-1234567-8');
    insert into public.product_costs (product_id, costs, strategy) values (1, '{1700}', 'normal') on conflict do nothing;
    insert into public.coupons (code, description, kind, value, max_uses, one_per_customer) values ('PROMO10','Prueba','percent',10,1,true);`);

  return db;
}

// Ponte en la piel de un rol. uid null = visitante sin cuenta (anon). Con uid = cliente con sesión (authenticated).
export async function comoRol(db, uid) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec('set role ' + (uid ? 'authenticated' : 'anon'));
}
// Rol dueño de la base (sin RLS): solo para preparar o comprobar, nunca para «atacar».
export async function comoDuenno(db) { await db.exec('reset role'); }
