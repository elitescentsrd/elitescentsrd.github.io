-- MENSAJES Y RESEÑAS — 7 de octubre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Mensajes de la página «Contacto»: tabla contact_messages y función send_contact_message. La tienda la usa sin
--      sesión, con límites: nombre, WhatsApp válido (dominicano de 10 dígitos o de otro país con + y el código) y un
--      mensaje de 5 a 1,000 letras; como máximo 3 mensajes cada 10 minutos y 10 al día por conexión, 5 al día por número
--      y 100 por hora en total. Solo los administradores los leen (sección «Mensajes» del panel). Se borran solos: los
--      atendidos a los 180 días y cualquiera al año; la huella de conexión (para frenar abusos) a los 7 días.
--   2. Reseñas verificadas: tabla product_reviews. Solo califica quien RECIBIÓ el perfume: cuando un pedido está
--      «entregado», el panel crea un enlace personal (admin_review_link) que mandas por WhatsApp, y el cliente con cuenta
--      también lo tiene en «Mis pedidos» (my_review_link). Con ese enlace califica cada perfume de ESE pedido una sola
--      vez (review_invite y submit_review). El enlace vence a los 90 días.
--   3. Nada se publica solo: cada reseña queda «pendiente» hasta que la publicas en el panel (sección «Reseñas»:
--      admin_reviews y admin_moderate_review). La tienda y Google ven solo las publicadas, y solo nombre, estrellas,
--      comentario y fecha (nunca el pedido, el teléfono ni la conexión).
--   4. Al publicar, ocultar o borrar una reseña, la web se vuelve a publicar sola (si ya está activa la publicación
--      automática del script del 3 de octubre «ESTADÍSTICAS Y PUBLICACIÓN»).
--
-- Requisitos: los scripts anteriores (administrador, encuesta y «LÍNEAS DE PEDIDO Y CANTIDAD EN CASA» del 3 de octubre).
--
-- Cómo usarlo: en GitHub, Actions → «Aplicar script en Supabase» → este archivo (primero «ensayar», luego «aplicar»).
-- O en Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige «Run
-- without RLS»: las tablas nuevas activan su protección aquí mismo). La primera línea empieza con «-- MENSAJES Y
-- RESEÑAS» y la última dice «-- FIN». Es seguro repetirlo.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo: quita los mensajes,
-- las reseñas, los enlaces y sus funciones (se borran los mensajes y las reseñas guardados). Los pedidos y los perfumes
-- no se tocan.

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null or to_regprocedure('private.request_ip_hash()') is null then
    raise exception 'Faltan las migraciones de administrador y de la encuesta. No se cambió nada.';
  end if;
  if to_regclass('public.order_items') is null then
    raise exception 'Primero corre el script «LÍNEAS DE PEDIDO Y CANTIDAD EN CASA» (3 de octubre). No se cambió nada.';
  end if;
end $$;

create temp table modo on commit drop as select false as deshacer;  -- ← DESHACER: cambia false por true

-- 0b) Turno: aparta perfumes y pedidos un instante, sin esperar con algo apartado (así no choca con un cliente que compra).
do $$
begin
  for intento in 1..80 loop
    begin
      if (select deshacer from modo) then
        lock table public.products, public.orders in access exclusive mode nowait;
      else
        lock table public.products, public.orders in share row exclusive mode nowait;
      end if;
      return;
    exception when lock_not_available then
      perform pg_sleep(0.25);
    end;
  end loop;
  raise exception 'La tienda está muy ocupada en este momento. Espera un minuto y vuelve a darle Run. No se cambió nada.';
end $$;

-- Texto escrito por el cliente: sin caracteres de control (salvo saltos de línea), sin espacios de más ni más de una
-- línea en blanco seguida.
create or replace function private.clean_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(replace(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\r', E'\n'),
    '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'), '[ \t]+', ' ', 'g'), E' ?\n ?', E'\n', 'g'), E'\n{3,}', E'\n\n', 'g'), E' \n');
$$;

-- 1) Mensajes de «Contacto».
create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 2 and 80),
  phone text not null check (phone ~ '^((809|829|849)[0-9]{7}|\+[1-9][0-9]{7,14})$'),
  topic text not null default 'otro' check (topic in ('perfume', 'pedido', 'envio', 'otro')),
  message text not null check (length(message) between 5 and 1000),
  status text not null default 'nuevo' check (status in ('nuevo', 'atendido')),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 128),
  created_at timestamptz not null default now(),
  attended_at timestamptz
);
create index if not exists contact_messages_created on public.contact_messages (created_at desc);
create index if not exists contact_messages_ip_time on public.contact_messages (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists contact_messages_phone_time on public.contact_messages (phone, created_at desc);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
grant select, delete on public.contact_messages to authenticated;
grant update (status, attended_at) on public.contact_messages to authenticated;
drop policy if exists "Admins leen mensajes" on public.contact_messages;
create policy "Admins leen mensajes" on public.contact_messages for select to authenticated
  using ((select private.is_store_admin()));
drop policy if exists "Admins marcan mensajes" on public.contact_messages;
create policy "Admins marcan mensajes" on public.contact_messages for update to authenticated
  using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
drop policy if exists "Admins borran mensajes" on public.contact_messages;
create policy "Admins borran mensajes" on public.contact_messages for delete to authenticated
  using ((select private.is_store_admin()));

create or replace function public.send_contact_message(p_name text, p_phone text, p_topic text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(private.clean_text(p_name), '\s+', ' ', 'g'));
  v_raw text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone text;
  v_topic text := lower(btrim(coalesce(p_topic, '')));
  v_message text := private.clean_text(p_message);
  v_ip text := private.request_ip_hash();
  v_recent integer;
  v_day integer;
begin
  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[<>{}]' or v_name !~ '[[:alpha:]]' then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu nombre (de 2 a 80 letras).');
  end if;
  -- WhatsApp: dominicano de 10 dígitos (con o sin el 1 delante) o de otro país con + (o 00) y el código del país.
  if v_raw ~ '^00' then
    v_digits := substr(v_digits, 3);
  end if;
  if v_digits ~ '^1?(809|829|849)[0-9]{7}$' then
    v_phone := right(v_digits, 10);
  elsif v_raw ~ '^(\+|00)' and v_digits ~ '^[1-9][0-9]{7,14}$' then
    v_phone := '+' || v_digits;
  end if;
  if v_phone is null then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu WhatsApp: 10 dígitos si es de República Dominicana (809, 829 u 849), o con + y el código del país si es de otro país.');
  end if;
  if v_topic not in ('perfume', 'pedido', 'envio', 'otro') then
    v_topic := 'otro';
  end if;
  if length(v_message) < 5 or length(v_message) > 1000 then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu mensaje (de 5 a 1,000 letras).');
  end if;
  if (length(v_message) - length(replace(lower(v_message), 'http', ''))) / 4 > 2 then
    return jsonb_build_object('ok', false, 'message', 'Tu mensaje tiene muchos enlaces: deja dos como máximo.');
  end if;
  -- Dos mensajes de la misma conexión a la vez esperan su turno: así nadie se salta los límites.
  perform pg_advisory_xact_lock(hashtextextended('elite-contact:' || coalesce(v_ip, 'sin-conexion'), 0));
  if exists (select 1 from public.contact_messages m where m.phone = v_phone and m.message = v_message and m.created_at > now() - interval '24 hours') then
    return jsonb_build_object('ok', true, 'already', true, 'message', 'Ya recibimos este mensaje. Te responderemos por WhatsApp.');
  end if;
  if v_ip is not null then
    select count(*) filter (where m.created_at > now() - interval '10 minutes'), count(*)
      into v_recent, v_day
      from public.contact_messages m
     where m.ip_hash = v_ip and m.created_at > now() - interval '24 hours';
    if v_recent >= 3 or v_day >= 10 then
      return jsonb_build_object('ok', false, 'message', 'Nos escribiste varias veces seguidas. Espera un rato o escríbenos por WhatsApp al 809-433-3348.');
    end if;
  end if;
  if (select count(*) from public.contact_messages m where m.phone = v_phone and m.created_at > now() - interval '24 hours') >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Ya recibimos varios mensajes de este número hoy. Te responderemos pronto por WhatsApp.');
  end if;
  if (select count(*) from public.contact_messages m where m.created_at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('ok', false, 'message', 'En este momento no podemos recibir más mensajes. Escríbenos por WhatsApp al 809-433-3348.');
  end if;
  insert into public.contact_messages (name, phone, topic, message, ip_hash) values (v_name, v_phone, v_topic, v_message, v_ip);
  -- Limpieza: los atendidos se borran a los 180 días, cualquiera al año y la huella de conexión a los 7 días.
  delete from public.contact_messages m
   where (m.status = 'atendido' and m.attended_at < now() - interval '180 days') or m.created_at < now() - interval '365 days';
  update public.contact_messages m set ip_hash = null where m.ip_hash is not null and m.created_at < now() - interval '7 days';
  return jsonb_build_object('ok', true, 'already', false, 'message', 'Listo, ' || split_part(v_name, ' ', 1) || ': recibimos tu mensaje y te responderemos por WhatsApp.');
end;
$$;
revoke all on function public.send_contact_message(text, text, text, text) from public;
grant execute on function public.send_contact_message(text, text, text, text) to anon, authenticated;

-- 2) Reseñas verificadas.
create table if not exists public.product_reviews (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id) on delete cascade,
  order_id bigint references public.orders (id) on delete set null,
  author_name text not null check (length(author_name) between 2 and 40),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 600),
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'oculta')),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 128),
  created_at timestamptz not null default now(),
  moderated_at timestamptz
);
create unique index if not exists product_reviews_once on public.product_reviews (order_id, product_id) where order_id is not null;
create index if not exists product_reviews_published on public.product_reviews (product_id, created_at desc) where status = 'aprobada';
create index if not exists product_reviews_status on public.product_reviews (status, created_at desc);
create index if not exists product_reviews_ip_time on public.product_reviews (ip_hash, created_at desc) where ip_hash is not null;
alter table public.product_reviews enable row level security;
revoke all on public.product_reviews from anon, authenticated;
-- La tienda y Google leen solo las publicadas y solo estas columnas (nunca el pedido, el estado ni la conexión).
-- Las reseñas se escriben solo con submit_review y se revisan solo con las funciones del panel.
grant select (id, product_id, author_name, rating, comment, created_at) on public.product_reviews to anon, authenticated;
drop policy if exists "Todos leen resenas publicadas" on public.product_reviews;
create policy "Todos leen resenas publicadas" on public.product_reviews for select to anon, authenticated
  using (status = 'aprobada');

-- Enlaces personales para calificar un pedido entregado (uno por pedido, de 32 letras al azar; vencen a los 90 días).
create table if not exists private.review_invites (
  order_id bigint primary key references public.orders (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
revoke all on private.review_invites from public, anon, authenticated;

-- Perfumes de la tienda que trae un pedido (por sus líneas), en el orden en que se pidieron.
create or replace function private.review_products(p_order_id bigint)
returns table (product_id bigint, name text, size text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, nullif(p.size, '')
    from (select i.product_id, min(i.position) as pos from public.order_items i
           where i.order_id = p_order_id and i.product_id is not null group by i.product_id) x
    join public.products p on p.id = x.product_id and p.active
   order by x.pos;
$$;

create or replace function private.review_token(p_order_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended('elite-review-invite:' || p_order_id, 0));
  select i.token into v_token from private.review_invites i where i.order_id = p_order_id and i.expires_at > now();
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '');
    insert into private.review_invites (order_id, token, expires_at) values (p_order_id, v_token, now() + interval '90 days')
      on conflict (order_id) do update set token = excluded.token, created_at = now(), expires_at = excluded.expires_at;
  else
    -- Si lo vuelves a mandar, el mismo enlace sirve al menos 30 días más.
    update private.review_invites i set expires_at = greatest(i.expires_at, now() + interval '30 days') where i.order_id = p_order_id;
  end if;
  return v_token;
end;
$$;

-- El pedido de un enlace (o por qué no sirve).
create or replace function private.review_order(p_token text, out order_id bigint, out problem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_invite private.review_invites;
  v_status text;
begin
  if v_token !~ '^[0-9a-f]{32}$' then
    problem := 'Este enlace no es válido. Escríbenos por WhatsApp al 809-433-3348 y te enviamos uno nuevo.';
    return;
  end if;
  select * into v_invite from private.review_invites i where i.token = v_token;
  if not found then
    problem := 'Este enlace no es válido. Escríbenos por WhatsApp al 809-433-3348 y te enviamos uno nuevo.';
    return;
  end if;
  if v_invite.expires_at <= now() then
    problem := 'Este enlace venció. Escríbenos por WhatsApp al 809-433-3348 y te enviamos uno nuevo.';
    return;
  end if;
  select o.status into v_status from public.orders o where o.id = v_invite.order_id;
  if coalesce(v_status, '') <> 'entregado' then
    problem := 'Este pedido todavía no figura como entregado. Escríbenos por WhatsApp al 809-433-3348.';
    return;
  end if;
  order_id := v_invite.order_id;
end;
$$;
revoke all on function private.clean_text(text) from public, anon, authenticated;
revoke all on function private.review_products(bigint) from public, anon, authenticated;
revoke all on function private.review_token(bigint) from public, anon, authenticated;
revoke all on function private.review_order(text) from public, anon, authenticated;

-- Panel: enlace para que el cliente de un pedido entregado califique sus perfumes.
create or replace function public.admin_review_link(p_order_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (select private.is_store_admin()) then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  select o.status into v_status from public.orders o where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Ese pedido ya no existe.');
  end if;
  if coalesce(v_status, 'nuevo') <> 'entregado' then
    return jsonb_build_object('ok', false, 'message', 'Primero marca el pedido como «entregado» y guárdalo: solo se califican perfumes ya recibidos.');
  end if;
  if not exists (select 1 from private.review_products(p_order_id)) then
    return jsonb_build_object('ok', false, 'message', 'No reconocí perfumes de la tienda en este pedido (revisa que el texto tenga el nombre del perfume).');
  end if;
  return jsonb_build_object('ok', true, 'token', private.review_token(p_order_id));
end;
$$;
revoke all on function public.admin_review_link(bigint) from public, anon;
grant execute on function public.admin_review_link(bigint) to authenticated;

-- «Mis pedidos»: el mismo enlace, solo para el dueño de la cuenta y solo si su pedido ya se entregó.
create or replace function public.my_review_link(p_order_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Inicia sesión para calificar tu pedido.');
  end if;
  select o.status into v_status from public.orders o where o.id = p_order_id and o.user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'No encontramos ese pedido en tu cuenta.');
  end if;
  if coalesce(v_status, 'nuevo') <> 'entregado' then
    return jsonb_build_object('ok', false, 'message', 'Podrás calificarlo cuando tu pedido esté entregado.');
  end if;
  if not exists (select 1 from private.review_products(p_order_id)) then
    return jsonb_build_object('ok', false, 'message', 'Este pedido no tiene perfumes para calificar.');
  end if;
  return jsonb_build_object('ok', true, 'token', private.review_token(p_order_id));
end;
$$;
revoke all on function public.my_review_link(bigint) from public, anon;
grant execute on function public.my_review_link(bigint) to authenticated;

-- Página de la reseña: qué perfumes trae el pedido del enlace (sin datos personales: solo el primer nombre).
create or replace function public.review_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order bigint;
  v_problem text;
  v_first text;
begin
  select r.order_id, r.problem into v_order, v_problem from private.review_order(p_token) r;
  if v_order is null then
    return jsonb_build_object('ok', false, 'message', v_problem);
  end if;
  select initcap(left(split_part(btrim(coalesce(o.customer_name, '')), ' ', 1), 30)) into v_first from public.orders o where o.id = v_order;
  return jsonb_build_object('ok', true, 'first_name', nullif(v_first, ''), 'products', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.product_id, 'name', x.name, 'size', x.size,
             'reviewed', exists (select 1 from public.product_reviews r where r.order_id = v_order and r.product_id = x.product_id)))
      from private.review_products(v_order) x), '[]'::jsonb));
end;
$$;
revoke all on function public.review_invite(text) from public;
grant execute on function public.review_invite(text) to anon, authenticated;

create or replace function public.submit_review(p_token text, p_product_id bigint, p_rating integer, p_comment text, p_author text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order bigint;
  v_problem text;
  v_author text := btrim(regexp_replace(private.clean_text(p_author), '\s+', ' ', 'g'));
  v_comment text := private.clean_text(p_comment);
  v_ip text := private.request_ip_hash();
begin
  select r.order_id, r.problem into v_order, v_problem from private.review_order(p_token) r;
  if v_order is null then
    return jsonb_build_object('ok', false, 'message', v_problem);
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    return jsonb_build_object('ok', false, 'message', 'Elige de 1 a 5 estrellas.');
  end if;
  if length(v_author) < 2 or length(v_author) > 40 or v_author ~ '[<>{}]' or v_author !~ '[[:alpha:]]' then
    return jsonb_build_object('ok', false, 'message', 'Escribe el nombre con el que se verá tu reseña (de 2 a 40 letras).');
  end if;
  if length(v_comment) > 600 then
    return jsonb_build_object('ok', false, 'message', 'El comentario puede tener hasta 600 letras.');
  end if;
  if v_comment ~* '(https?://|www\.)' then
    return jsonb_build_object('ok', false, 'message', 'Quita los enlaces del comentario.');
  end if;
  if not exists (select 1 from private.review_products(v_order) x where x.product_id = p_product_id) then
    return jsonb_build_object('ok', false, 'message', 'Ese perfume no es de este pedido.');
  end if;
  -- Dos envíos del mismo pedido a la vez esperan su turno: así un perfume no se califica dos veces.
  perform pg_advisory_xact_lock(hashtextextended('elite-review:' || v_order, 0));
  if exists (select 1 from public.product_reviews r where r.order_id = v_order and r.product_id = p_product_id) then
    return jsonb_build_object('ok', true, 'already', true, 'message', 'Ya habías calificado este perfume. ¡Gracias!');
  end if;
  if v_ip is not null and (select count(*) from public.product_reviews r where r.ip_hash = v_ip and r.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'message', 'Enviaste muchas reseñas seguidas. Intenta más tarde.');
  end if;
  if (select count(*) from public.product_reviews r where r.created_at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'message', 'En este momento no podemos recibir más reseñas. Intenta más tarde.');
  end if;
  insert into public.product_reviews (product_id, order_id, author_name, rating, comment, ip_hash)
  values (p_product_id, v_order, v_author, p_rating, v_comment, v_ip);
  update public.product_reviews r set ip_hash = null where r.ip_hash is not null and r.created_at < now() - interval '7 days';
  return jsonb_build_object('ok', true, 'already', false, 'message', '¡Gracias! Publicaremos tu reseña cuando la revisemos.');
end;
$$;
revoke all on function public.submit_review(text, bigint, integer, text, text) from public;
grant execute on function public.submit_review(text, bigint, integer, text, text) to anon, authenticated;

-- Panel: todas las reseñas (primero las que faltan por revisar), con el perfume y el pedido del que vienen.
create or replace function public.admin_reviews()
returns table (id bigint, product_id bigint, product_name text, order_id bigint, customer_name text, author_name text,
               rating smallint, comment text, status text, created_at timestamptz, moderated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.product_id, p.name, r.order_id, o.customer_name, r.author_name, r.rating, r.comment, r.status, r.created_at, r.moderated_at
    from public.product_reviews r
    left join public.products p on p.id = r.product_id
    left join public.orders o on o.id = r.order_id
   where (select private.is_store_admin())
   order by (r.status = 'pendiente') desc, r.created_at desc
   limit 5000;
$$;
revoke all on function public.admin_reviews() from public, anon;
grant execute on function public.admin_reviews() to authenticated;

-- Panel: publicar, ocultar, volver a «por revisar» o borrar una reseña.
create or replace function public.admin_moderate_review(p_id bigint, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := case lower(btrim(coalesce(p_action, ''))) when 'publicar' then 'aprobada' when 'ocultar' then 'oculta' when 'revisar' then 'pendiente' end;
begin
  if not (select private.is_store_admin()) then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_action, ''))) = 'borrar' then
    delete from public.product_reviews r where r.id = p_id;
  elsif v_status is null then
    return jsonb_build_object('ok', false, 'message', 'Acción desconocida.');
  else
    update public.product_reviews r set status = v_status, moderated_at = now() where r.id = p_id and r.status <> v_status;
    if not found and exists (select 1 from public.product_reviews r where r.id = p_id) then
      return jsonb_build_object('ok', true);
    end if;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Esa reseña ya no existe.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_moderate_review(bigint, text) from public, anon;
grant execute on function public.admin_moderate_review(bigint, text) to authenticated;

-- 3) Publicar la web cuando se publica, se oculta o se borra una reseña publicada (las que llegan o se quedan «por
--    revisar» no la cambian). Solo si existe la publicación automática del 3 de octubre.
do $$
begin
  if to_regprocedure('private.request_site_publish()') is not null then
    execute $t$create or replace trigger product_reviews_publish_change after update of status on public.product_reviews
               for each row when (old.status is distinct from new.status and 'aprobada' in (old.status, new.status))
               execute function private.request_site_publish()$t$;
    execute $t$create or replace trigger product_reviews_publish_delete after delete on public.product_reviews
               for each row when (old.status = 'aprobada')
               execute function private.request_site_publish()$t$;
  end if;
end $$;

-- DESHACER: quita todo lo de este archivo (la parte de arriba es idempotente; aquí se borra si se pidió deshacer).
do $$
begin
  if (select deshacer from modo) then
    drop function if exists public.admin_moderate_review(bigint, text);
    drop function if exists public.admin_reviews();
    drop function if exists public.submit_review(text, bigint, integer, text, text);
    drop function if exists public.review_invite(text);
    drop function if exists public.my_review_link(bigint);
    drop function if exists public.admin_review_link(bigint);
    drop function if exists private.review_order(text);
    drop function if exists private.review_token(bigint);
    drop function if exists private.review_products(bigint);
    drop table if exists private.review_invites;
    drop table if exists public.product_reviews;
    drop function if exists public.send_contact_message(text, text, text, text);
    drop table if exists public.contact_messages;
    drop function if exists private.clean_text(text);
  end if;
end $$;

-- Resumen (se arma aparte para no nombrar tablas que, al deshacer, ya no existen).
create temp table resumen (orden integer, cambio text, estado text) on commit drop;
do $$
declare
  v_reviews text := 'quitadas';
  v_messages text := 'quitados';
begin
  if to_regclass('public.contact_messages') is not null then
    execute $q$select 'listos: llegan a la sección «Mensajes» del panel (' || count(*) || ' guardados)' from public.contact_messages$q$ into v_messages;
  end if;
  if to_regclass('public.product_reviews') is not null then
    execute $q$select 'listas: en «Pedidos», los entregados tienen «Pedir reseña» (' || count(*) filter (where status = 'aprobada') || ' publicadas, '
                 || count(*) filter (where status = 'pendiente') || ' por revisar)' from public.product_reviews$q$ into v_reviews;
  end if;
  insert into resumen values
    (1, 'Mensajes de la página «Contacto»', v_messages),
    (2, 'Reseñas verificadas', v_reviews),
    (3, 'Publicar la web al publicar una reseña',
        case when to_regclass('public.product_reviews') is null then 'quitada'
             when exists (select 1 from pg_trigger where tgname = 'product_reviews_publish_change') then 'lista (usa la publicación automática del 3 de octubre)'
             else 'falta el script «ESTADÍSTICAS Y PUBLICACIÓN» (3 de octubre): la web se publica igual cada 6 horas' end);
end $$;
select cambio, estado from resumen order by orden;
-- FIN
