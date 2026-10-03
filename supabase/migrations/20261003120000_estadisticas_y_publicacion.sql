-- ESTADÍSTICAS Y PUBLICACIÓN AUTOMÁTICA — 3 de octubre de 2026
--
-- Qué hace (todo en una sola operación: si algo falla, no se cambia nada):
--   1. Estadísticas propias, sin terceros: tabla site_events y función track_event. La tienda cuenta visitas, perfumes
--      vistos, búsquedas (y las que no encontraron nada), clics a WhatsApp y productos agregados al carrito, SOLO si el
--      visitante aceptó «todas» en el aviso de cookies. No guarda nombres, teléfonos ni correos (las búsquedas con un
--      correo o un número largo se descartan); la huella de conexión (para frenar abusos) se borra a los 2 días y los
--      eventos a los 13 meses. Límites: 120 eventos cada 10 minutos por conexión y 6,000 por hora en total.
--   2. Resumen para el panel (admin_site_stats): solo administradores; devuelve totales, días, perfumes más vistos,
--      búsquedas, búsquedas sin resultado, de dónde llegan y desde qué aparato.
--   3. Publicación automática: cuando guardas un perfume en el panel, Supabase le avisa a GitHub para que la web se
--      publique en unos minutos (en vez de esperar hasta 6 horas). No hace nada hasta que guardes la clave de GitHub
--      (ver al final). Como máximo un aviso cada 30 segundos; un error al avisar nunca impide guardar el perfume.
--
-- Requisitos: los scripts anteriores (administrador, ofertas, protección de pedidos, encuesta y el del 30 de septiembre).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este archivo → Run (si aparece el aviso de RLS, elige
-- «Run without RLS»: las tablas nuevas activan su protección aquí mismo). La primera línea empieza con
-- «-- ESTADÍSTICAS Y PUBLICACIÓN» y la última dice «-- FIN». Es seguro repetirlo.
--
-- DESHACER: cambia «false» por «true» en la línea marcada con «DESHACER» y vuelve a ejecutarlo: quita la publicación
-- automática, las funciones y las estadísticas guardadas.

-- 0) Comprobaciones: si falta algo, se detiene con un mensaje claro y no cambia nada.
do $$
begin
  if to_regprocedure('private.is_store_admin()') is null or to_regprocedure('private.request_ip_hash()') is null then
    raise exception 'Faltan las migraciones de administrador y de la encuesta. No se cambió nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'inspired_by') then
    raise exception 'Primero corre el script «FUNCIONES NUEVAS Y PERFUMES NUEVOS» (30 de septiembre). No se cambió nada.';
  end if;
end $$;

create temp table modo on commit drop as select false as deshacer;  -- ← DESHACER: cambia false por true

-- 0b) Turno: aparta los perfumes un instante sin esperar con algo apartado (así no choca con un cliente que compra).
do $$
begin
  for intento in 1..80 loop
    begin
      if (select deshacer from modo) then
        lock table public.products in access exclusive mode nowait;
      else
        lock table public.products in share row exclusive mode nowait;
      end if;
      return;
    exception when lock_not_available then
      perform pg_sleep(0.25);
    end;
  end loop;
  raise exception 'La tienda está muy ocupada en este momento. Espera un minuto y vuelve a darle Run. No se cambió nada.';
end $$;

-- 1) Estadísticas.
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('visita', 'perfume', 'busqueda', 'sin_resultado', 'whatsapp', 'carrito')),
  product_id bigint references public.products (id) on delete set null,
  term text check (term is null or length(term) between 2 and 60),
  source text check (source is null or length(source) <= 40),
  device text check (device is null or device in ('movil', 'computadora')),
  day date not null default ((now() at time zone 'America/Santo_Domingo')::date),
  created_at timestamptz not null default now(),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 128)
);
create index if not exists site_events_day on public.site_events (day, kind);
create index if not exists site_events_created on public.site_events (created_at);
create index if not exists site_events_ip on public.site_events (ip_hash, created_at) where ip_hash is not null;
alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
-- Nadie lee la tabla directamente: el panel usa admin_site_stats (resumen, solo administradores).

create or replace function public.track_event(p_kind text, p_product_id bigint default null, p_term text default null, p_source text default null, p_device text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_ip text;
  v_term text;
  v_product bigint;
begin
  if v_kind not in ('visita', 'perfume', 'busqueda', 'sin_resultado', 'whatsapp', 'carrito') then
    return;
  end if;
  v_ip := private.request_ip_hash();
  -- Límites contra abuso: 120 eventos cada 10 minutos por conexión y 6,000 por hora en total (los demás se ignoran).
  perform pg_advisory_xact_lock(hashtextextended('elite-stats:' || coalesce(v_ip, 'sin-ip'), 0));
  if v_ip is not null and (select count(*) from public.site_events e where e.ip_hash = v_ip and e.created_at > now() - interval '10 minutes') >= 120 then
    return;
  end if;
  if (select count(*) from public.site_events e where e.created_at > now() - interval '1 hour') >= 6000 then
    return;
  end if;
  if v_kind in ('busqueda', 'sin_resultado') then
    v_term := regexp_replace(lower(trim(coalesce(p_term, ''))), '\s+', ' ', 'g');
    -- Nunca se guardan correos ni números largos: podrían ser datos personales escritos por error en el buscador.
    if length(v_term) < 2 or length(v_term) > 60 or v_term like '%@%' or v_term ~ '[0-9]{6,}' then
      return;
    end if;
  end if;
  if p_product_id is not null and v_kind in ('perfume', 'whatsapp', 'carrito') then
    select p.id into v_product from public.products p where p.id = p_product_id and p.active;
  end if;
  if v_kind = 'perfume' and v_product is null then
    return;
  end if;
  insert into public.site_events (kind, product_id, term, source, device, ip_hash)
  values (
    v_kind, v_product, v_term,
    case when v_kind = 'visita' then nullif(left(regexp_replace(lower(coalesce(p_source, '')), '[^a-z0-9._-]', '', 'g'), 40), '') end,
    case when v_kind = 'visita' and p_device in ('movil', 'computadora') then p_device end,
    v_ip
  );
  -- Limpieza ocasional: la huella de conexión se borra a los 2 días y los eventos a los 13 meses.
  if random() < 0.02 then
    update public.site_events set ip_hash = null where ip_hash is not null and created_at < now() - interval '2 days';
    delete from public.site_events where created_at < now() - interval '400 days';
  end if;
end;
$$;
revoke all on function public.track_event(text, bigint, text, text, text) from public;
grant execute on function public.track_event(text, bigint, text, text, text) to anon, authenticated;

-- 2) Resumen para el panel (solo administradores).
create or replace function public.admin_site_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 400));
  v_from date;
begin
  if not (select private.is_store_admin()) then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  v_from := (now() at time zone 'America/Santo_Domingo')::date - (v_days - 1);
  return jsonb_build_object(
    'desde', v_from,
    'dias', v_days,
    'totales', (select jsonb_build_object(
        'visitas', count(*) filter (where e.kind = 'visita'),
        'perfumes', count(*) filter (where e.kind = 'perfume'),
        'busquedas', count(*) filter (where e.kind in ('busqueda', 'sin_resultado')),
        'sin_resultado', count(*) filter (where e.kind = 'sin_resultado'),
        'whatsapp', count(*) filter (where e.kind = 'whatsapp'),
        'carrito', count(*) filter (where e.kind = 'carrito'))
      from public.site_events e where e.day >= v_from),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d.day, 'visitas', d.visitas, 'perfumes', d.perfumes) order by d.day)
      from (select e.day, count(*) filter (where e.kind = 'visita') as visitas, count(*) filter (where e.kind = 'perfume') as perfumes
              from public.site_events e where e.day >= v_from group by e.day) d), '[]'::jsonb),
    'perfumes', coalesce((select jsonb_agg(jsonb_build_object('id', t.product_id, 'nombre', t.name, 'vistas', t.vistas, 'whatsapp', t.wa, 'carrito', t.cart) order by t.vistas desc, t.wa desc, t.name)
      from (select e.product_id, p.name,
                   count(*) filter (where e.kind = 'perfume') as vistas,
                   count(*) filter (where e.kind = 'whatsapp') as wa,
                   count(*) filter (where e.kind = 'carrito') as cart
              from public.site_events e join public.products p on p.id = e.product_id
             where e.day >= v_from
             group by e.product_id, p.name
             order by 3 desc, 4 desc, p.name
             limit 20) t), '[]'::jsonb),
    'busquedas', coalesce((select jsonb_agg(jsonb_build_object('texto', t.term, 'veces', t.veces, 'sin_resultado', t.vacias) order by t.veces desc, t.term)
      from (select e.term, count(*) as veces, count(*) filter (where e.kind = 'sin_resultado') as vacias
              from public.site_events e where e.day >= v_from and e.term is not null
             group by e.term order by 2 desc, e.term limit 25) t), '[]'::jsonb),
    'sin_resultado', coalesce((select jsonb_agg(jsonb_build_object('texto', t.term, 'veces', t.veces) order by t.veces desc, t.term)
      from (select e.term, count(*) as veces from public.site_events e
             where e.day >= v_from and e.kind = 'sin_resultado' and e.term is not null
             group by e.term order by 2 desc, e.term limit 25) t), '[]'::jsonb),
    'origenes', coalesce((select jsonb_agg(jsonb_build_object('origen', t.origen, 'visitas', t.veces) order by t.veces desc)
      from (select coalesce(e.source, 'directo') as origen, count(*) as veces from public.site_events e
             where e.day >= v_from and e.kind = 'visita' group by 1 order by 2 desc limit 12) t), '[]'::jsonb),
    'dispositivos', coalesce((select jsonb_agg(jsonb_build_object('dispositivo', t.dev, 'visitas', t.veces) order by t.veces desc)
      from (select coalesce(e.device, 'sin dato') as dev, count(*) as veces from public.site_events e
             where e.day >= v_from and e.kind = 'visita' group by 1) t), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_site_stats(integer) from public;
grant execute on function public.admin_site_stats(integer) to authenticated;

-- 3) Publicación automática al guardar un perfume.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net no está disponible (%): la publicación automática quedará inactiva; la web se sigue publicando cada 6 horas.', sqlerrm;
end $$;

create table if not exists private.publish_state (
  id boolean primary key default true check (id),
  last_request timestamptz,
  requests bigint not null default 0
);
revoke all on private.publish_state from public, anon, authenticated;

create or replace function private.request_site_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_last timestamptz;
begin
  begin
    select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'github_publish_token' limit 1;
  exception when others then
    return null; -- Vault no disponible: sin publicación automática.
  end;
  if v_token is null or v_token = '' then
    return null; -- Todavía no guardaste la clave de GitHub.
  end if;
  insert into private.publish_state (id) values (true) on conflict (id) do nothing;
  select ps.last_request into v_last from private.publish_state ps where ps.id for update;
  if v_last is not null and v_last > now() - interval '30 seconds' then
    return null; -- Ya se avisó hace un momento: esa publicación incluirá este cambio.
  end if;
  update private.publish_state set last_request = now(), requests = requests + 1 where id;
  perform net.http_post(
    url := 'https://api.github.com/repos/elitescentsrd/elitescentsrd.github.io/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json', 'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'elite-scents-supabase', 'Content-Type', 'application/json'),
    body := jsonb_build_object('event_type', 'catalogo')
  );
  return null;
exception when others then
  return null; -- Un error al avisar a GitHub nunca impide guardar el perfume.
end;
$$;
revoke all on function private.request_site_publish() from public, anon, authenticated;
create or replace trigger products_request_publish
  after insert or update or delete on public.products
  for each statement execute function private.request_site_publish();

-- DESHACER: quita todo lo de este archivo (la parte de arriba es idempotente; aquí se borra si se pidió deshacer).
do $$
begin
  if (select deshacer from modo) then
    drop trigger if exists products_request_publish on public.products;
    drop function if exists private.request_site_publish();
    drop table if exists private.publish_state;
    drop function if exists public.admin_site_stats(integer);
    drop function if exists public.track_event(text, bigint, text, text, text);
    drop table if exists public.site_events;
  end if;
end $$;

select 'Estadísticas (visitas, perfumes, búsquedas, WhatsApp, carrito)' as cambio,
       case when to_regclass('public.site_events') is null then 'quitadas' else 'listas' end as estado
union all
select 'Publicación automática al guardar un perfume',
       case
         when not exists (select 1 from pg_trigger where tgname = 'products_request_publish') then 'quitada'
         when to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then 'falta activar pg_net (Database → Extensions)'
         when to_regclass('vault.decrypted_secrets') is null then 'falta Vault'
         else 'lista: falta guardar la clave de GitHub (si ya la guardaste, está activa)'
       end;

-- Para activar la publicación automática, crea en GitHub una clave «fine-grained» solo para este repositorio, con
-- permiso Contents: Read and write, y guárdala aquí UNA vez (en una consulta aparte, cambiando el texto entre comillas):
--   select vault.create_secret('github_pat_PEGA_AQUI_TU_CLAVE', 'github_publish_token');
-- Para cambiarla después:  select vault.update_secret((select id from vault.secrets where name = 'github_publish_token'), 'NUEVA_CLAVE');
-- FIN
