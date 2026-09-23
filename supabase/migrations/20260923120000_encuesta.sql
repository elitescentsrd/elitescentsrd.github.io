-- ENCUESTA CON CUPÓN PERSONAL.
--
-- Qué hace:
--   * Tabla survey_responses: una respuesta por cuenta de cliente (solo los administradores la leen).
--   * submit_survey(respuestas): la persona, con su sesión iniciada, envía la encuesta y recibe un cupón PERSONAL de un
--     solo uso (por ejemplo ES-7K2Q9M) que SOLO funciona en su cuenta. Si la vuelve a enviar, recibe el mismo cupón.
--   * my_survey_coupon(): el cliente ve su cupón de la encuesta cuando entra a su cuenta.
--   * survey_info(): datos públicos de la encuesta (si está activa y de cuánto es el cupón) para mostrarlos en la tienda.
--   * Ajustes en store_settings (el panel los cambia): encuesta activa, monto del cupón, días de validez y compra mínima.
--   * Cupones: columnas user_id (cupón personal) y source ('encuesta'); la regla del cupón rechaza un cupón personal
--     usado desde otra cuenta. Los cupones que creas en el panel no cambian.
--
-- Es seguro ejecutarla más de una vez. Requisitos: migraciones de cupones y de protección de pedidos.
--
-- Para desactivar la encuesta sin borrar nada: panel -> Encuesta -> desmarca "Encuesta activa".

create schema if not exists private;

do $$
begin
  if to_regclass('public.coupons') is null or to_regprocedure('private.coupon_evaluate(uuid,text,bigint[],numeric,boolean,bigint)') is null then
    raise exception 'Falta la migración de cupones (20260921130000_cupones.sql). No se cambió nada.';
  end if;
  if to_regclass('public.store_settings') is null then
    raise exception 'Falta la migración de protección de pedidos (20260922120000_proteccion_pedidos.sql). No se cambió nada.';
  end if;
end $$;

-- 1) Ajustes de la encuesta (una sola fila en store_settings).
alter table public.store_settings
  add column if not exists survey_enabled boolean not null default true,
  add column if not exists survey_amount numeric(12,2) not null default 300 check (survey_amount > 0 and survey_amount <= 5000),
  add column if not exists survey_valid_days integer not null default 30 check (survey_valid_days between 1 and 365),
  add column if not exists survey_min_subtotal numeric(12,2) not null default 0 check (survey_min_subtotal >= 0);
grant update (survey_enabled, survey_amount, survey_valid_days, survey_min_subtotal) on public.store_settings to authenticated;

-- 2) Cupones personales.
alter table public.coupons
  add column if not exists user_id uuid references auth.users (id) on delete cascade,
  add column if not exists source text check (source is null or source in ('encuesta'));
create index if not exists coupons_user on public.coupons (user_id) where user_id is not null;

-- 3) Respuestas (una por cuenta).
create table if not exists public.survey_responses (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  answers jsonb not null,
  coupon_code text references public.coupons (code) on update cascade on delete set null,
  created_at timestamptz not null default now()
);
alter table public.survey_responses enable row level security;
revoke all on public.survey_responses from anon, authenticated;
grant select on public.survey_responses to authenticated;
drop policy if exists "Admins leen encuestas" on public.survey_responses;
create policy "Admins leen encuestas" on public.survey_responses for select to authenticated
  using ((select private.is_store_admin()));

-- 4) Regla del cupón: igual que antes, más "un cupón personal solo lo usa su dueño".
create or replace function private.coupon_evaluate(
  p_uid uuid, p_code text, p_product_ids bigint[], p_subtotal numeric, p_record boolean default true, p_exclude_order bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_c public.coupons;
  v_recent integer;
  v_fail text;
  v_discount numeric;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'Escribe tu código de descuento.');
  end if;

  -- Freno: más de 8 códigos inexistentes en 10 minutos y se pausa la comprobación (evita adivinar códigos).
  select count(*) into v_recent from public.coupon_attempts where user_id = p_uid and attempted_at > now() - interval '10 minutes';
  if v_recent >= 8 then
    return jsonb_build_object('ok', false, 'message', 'Demasiados intentos. Espera unos minutos y vuelve a probar.');
  end if;

  select * into v_c from public.coupons where code = v_code;
  if not found then
    if p_record then
      insert into public.coupon_attempts (user_id) values (p_uid);
      delete from public.coupon_attempts where attempted_at < now() - interval '1 day';
    end if;
    return jsonb_build_object('ok', false, 'message', 'Ese código no existe o ya no es válido.');
  end if;

  v_fail := case
    when not v_c.active then 'Ese código no está activo.'
    when v_c.user_id is not null and v_c.user_id is distinct from p_uid then 'Este cupón es personal: solo lo puede usar la cuenta que llenó la encuesta.'
    when v_c.starts_at is not null and now() < v_c.starts_at then 'Este cupón todavía no ha empezado.'
    when v_c.ends_at is not null and now() >= v_c.ends_at then 'Este cupón ya venció.'
    when v_c.max_uses is not null and v_c.used_count >= v_c.max_uses then 'Este cupón ya alcanzó su límite de usos.'
    when v_c.one_per_customer and exists (select 1 from public.coupon_redemptions r where r.coupon_code = v_c.code and r.user_id = p_uid) then 'Ya usaste este cupón.'
    when v_c.first_order_only and exists (select 1 from public.orders o where o.user_id = p_uid and o.status <> 'cancelado' and o.id <> coalesce(p_exclude_order, -1)) then 'Este cupón es solo para tu primera compra.'
    when not v_c.allow_with_offers and exists (select 1 from public.products p where p.id = any (coalesce(p_product_ids, '{}'::bigint[])) and p.original_price is not null) then 'Este cupón no se combina con perfumes que ya están en oferta.'
    else null
  end;
  if v_fail is not null then
    return jsonb_build_object('ok', false, 'message', v_fail);
  end if;

  if p_subtotal is null then
    return jsonb_build_object('ok', true, 'code', v_c.code, 'description', v_c.description, 'kind', v_c.kind, 'value', v_c.value);
  end if;
  if p_subtotal < v_c.min_subtotal then
    return jsonb_build_object('ok', false, 'message', 'Este cupón requiere un pedido de al menos RD$' || to_char(v_c.min_subtotal, 'FM999,999,999') || '.');
  end if;

  v_discount := case when v_c.kind = 'percent' then round(p_subtotal * v_c.value / 100) else round(v_c.value) end;
  if v_c.max_discount is not null then v_discount := least(v_discount, round(v_c.max_discount)); end if;
  v_discount := least(v_discount, p_subtotal);
  return jsonb_build_object('ok', true, 'code', v_c.code, 'description', v_c.description, 'kind', v_c.kind, 'value', v_c.value,
                            'discount', v_discount, 'subtotal', p_subtotal, 'total', greatest(p_subtotal - v_discount, 0));
end;
$$;
revoke all on function private.coupon_evaluate(uuid, text, bigint[], numeric, boolean, bigint) from public, anon, authenticated;

-- 5) Datos públicos de la encuesta (para la tienda): activa o no y de cuánto es el cupón. No expone nada más.
create or replace function public.survey_info()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('enabled', s.survey_enabled, 'amount', s.survey_amount, 'valid_days', s.survey_valid_days, 'min_subtotal', s.survey_min_subtotal)
       from public.store_settings s where s.id),
    jsonb_build_object('enabled', false));
$$;
revoke all on function public.survey_info() from public;
grant execute on function public.survey_info() to anon, authenticated;

-- 6) Enviar la encuesta y recibir el cupón personal.
create or replace function public.submit_survey(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.store_settings;
  v_prev public.survey_responses;
  v_c public.coupons;
  v_key text;
  v_val jsonb;
  v_item jsonb;
  v_answered integer := 0;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_raw text;
  v_code text;
  v_tries integer := 0;
  v_ends timestamptz;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para recibir tu cupón.' using errcode = '28000';
  end if;
  -- Dos envíos a la vez de la misma cuenta esperan su turno: nunca se crean dos cupones.
  perform pg_advisory_xact_lock(hashtextextended('elite-survey:' || v_uid::text, 0));

  select * into v_prev from public.survey_responses where user_id = v_uid;
  if found then
    select * into v_c from public.coupons where code = v_prev.coupon_code;
    if not found then
      return jsonb_build_object('ok', true, 'already', true, 'code', null, 'message', 'Ya llenaste la encuesta. Tu cupón ya no está disponible.');
    end if;
    return jsonb_build_object('ok', true, 'already', true, 'code', v_c.code, 'amount', v_c.value, 'ends_at', v_c.ends_at, 'min_subtotal', v_c.min_subtotal, 'used', v_c.used_count > 0);
  end if;

  select * into v_s from public.store_settings where id;
  if not found or not v_s.survey_enabled then
    return jsonb_build_object('ok', false, 'message', 'La encuesta no está disponible en este momento.');
  end if;

  -- Respuestas: un objeto pequeño con textos cortos o listas de textos cortos.
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 3000
     or (select count(*) from jsonb_object_keys(p_answers)) > 12 then
    raise exception 'Las respuestas no son válidas.' using errcode = '22023';
  end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_answers) e loop
    if v_key !~ '^[a-z_]{1,40}$' then
      raise exception 'Las respuestas no son válidas.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) = 'string' then
      if length(v_val #>> '{}') > 300 then raise exception 'Las respuestas no son válidas.' using errcode = '22023'; end if;
      if length(trim(v_val #>> '{}')) > 0 then v_answered := v_answered + 1; end if;
    elsif jsonb_typeof(v_val) = 'array' then
      if jsonb_array_length(v_val) > 10 then raise exception 'Las respuestas no son válidas.' using errcode = '22023'; end if;
      for v_item in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_item) <> 'string' or length(v_item #>> '{}') > 80 then
          raise exception 'Las respuestas no son válidas.' using errcode = '22023';
        end if;
      end loop;
      if jsonb_array_length(v_val) > 0 then v_answered := v_answered + 1; end if;
    elsif jsonb_typeof(v_val) <> 'null' then
      raise exception 'Las respuestas no son válidas.' using errcode = '22023';
    end if;
  end loop;
  if v_answered < 4 then
    return jsonb_build_object('ok', false, 'message', 'Responde las preguntas de la encuesta para recibir tu cupón.');
  end if;

  -- Código personal al azar (sin letras que se confundan: sin I, L, O, 0 ni 1), por ejemplo ES-7K2Q9M.
  loop
    v_tries := v_tries + 1;
    v_raw := replace(gen_random_uuid()::text, '-', '');
    v_code := 'ES-';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, 1 + (('x' || substr(v_raw, 1 + i * 2, 2))::bit(8)::int % length(v_alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.coupons where code = v_code);
    if v_tries >= 10 then
      raise exception 'No se pudo crear el cupón. Intenta de nuevo.';
    end if;
  end loop;

  v_ends := now() + make_interval(days => v_s.survey_valid_days);
  insert into public.coupons (code, description, kind, value, min_subtotal, max_uses, one_per_customer, first_order_only, allow_with_offers, ends_at, active, user_id, source)
  values (v_code, 'Encuesta', 'amount', v_s.survey_amount, v_s.survey_min_subtotal, 1, true, false, false, v_ends, true, v_uid, 'encuesta');
  insert into public.survey_responses (user_id, answers, coupon_code) values (v_uid, p_answers, v_code);

  return jsonb_build_object('ok', true, 'already', false, 'code', v_code, 'amount', v_s.survey_amount, 'ends_at', v_ends, 'min_subtotal', v_s.survey_min_subtotal, 'used', false);
end;
$$;
revoke all on function public.submit_survey(jsonb) from public, anon;
grant execute on function public.submit_survey(jsonb) to authenticated;

-- 7) El cupón de la encuesta del cliente (para mostrarlo en su cuenta). null si todavía no la llenó.
create or replace function public.my_survey_coupon()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then null else (
    select jsonb_build_object('responded', true, 'code', c.code, 'amount', c.value, 'ends_at', c.ends_at, 'min_subtotal', c.min_subtotal,
                              'used', coalesce(c.used_count, 0) > 0, 'expired', c.ends_at is not null and c.ends_at <= now(), 'active', coalesce(c.active, false))
      from public.survey_responses r left join public.coupons c on c.code = r.coupon_code
     where r.user_id = (select auth.uid())) end;
$$;
revoke all on function public.my_survey_coupon() from public, anon;
grant execute on function public.my_survey_coupon() to authenticated;

-- Comprobación (debe devolver la encuesta activa con cupón de 300):
--   select public.survey_info();
