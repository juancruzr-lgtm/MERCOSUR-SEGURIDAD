-- ============================================================================
-- 20261008100000 · Extras del mes desde la planilla + registro de pagos del banco
-- ============================================================================
-- Problema (JC 08/10): el archivo "Galicia — Extras" y la columna del Excel sólo
-- tomaban la EXTRA fija mensual (liquidacion_extra_mensual). Las extras POR HORAS
-- de los vigiladores (columna AP de la planilla) no se pagaban por banco: en
-- septiembre AP sumaba $14.441.834,60 y el archivo $1.459.334,60.
--
-- Desde ahora el importe de extras de cada persona es la columna AP FINAL de la
-- planilla del período (extras por horas, extra fija vía BG, o el importe escrito
-- a mano), que calcula la app. La base sólo aporta:
--   1) pagos_banco_destinatarios(): a quién se le puede depositar y, si no, POR
--      QUÉ (inactivo, excluido del pago por banco, sin cuenta). Una sola regla
--      para sueldos y extras.
--   2) Registro de pagos efectivamente hechos (liquidacion_pago_lote / _registrado):
--      se registra al confirmar el pago del archivo; nada se infiere de cálculos.
--      EXTRAS PENDIENTES = extras del mes − extras registradas como pagadas.
--   3) pagos_extras_banco() queda RETIRADA (daba sólo la extra fija): la app ya no
--      la usa; si algo la llama, falla con un mensaje claro en vez de pagar de menos.
--
-- No modifica datos existentes.
-- ROLLBACK:     supabase/rollback/20261008100000_extras_del_mes_y_pagos_registrados_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20261008100000_extras_del_mes_y_pagos_registrados_pre_post.sql
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.pagos_banco_por_usuario(uuid)') is null then raise exception 'falta pagos_banco_por_usuario (20261007130000)'; end if;
  if to_regprocedure('public.puede_liquidar_actual()') is null then raise exception 'falta puede_liquidar_actual'; end if;
end $$;

-- 1) Destinatarios del banco: todos los usuarios no de prueba, con motivo de exclusión.
create or replace function public.pagos_banco_destinatarios()
 returns table(usuario_id uuid, cuenta text, nombre text, orden int, habilitado boolean, motivo text)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede generar el archivo del banco';
  end if;
  return query
  select u.id, nullif(btrim(u.cuenta_bancaria), ''), u.apellido || ', ' || coalesce(u.nombre, ''),
         public.grupo_orden_banco(u.puesto_organizacional, u.rol),
         m.motivo is null,
         m.motivo
  from public.usuarios u
  cross join lateral (select case
      when u.estado <> 'activo' then 'inactivo'
      when coalesce(u.excluir_pago_banco, false) then 'excluido del pago por banco (baja)'
      when nullif(btrim(u.cuenta_bancaria), '') is null then 'sin cuenta bancaria cargada'
    end as motivo) m
  where not coalesce(u.es_prueba, false);
end;
$function$;
revoke all on function public.pagos_banco_destinatarios() from public, anon;
grant execute on function public.pagos_banco_destinatarios() to authenticated;

-- 2) Sueldos: misma regla de destinatarios (sin cambios de importes respecto de
--    20261007130000). Se quita la columna de extras (eran sólo la extra fija).
drop function if exists public.pagos_sueldos_banco(uuid);
drop function if exists public.pagos_extras_banco(uuid);
drop function if exists public.pagos_banco_por_usuario(uuid);

create function public.pagos_banco_por_usuario(p_periodo_id uuid)
 returns table(usuario_id uuid, cuenta text, nombre text, sueldo numeric, adelantos numeric, sueldo_fijo boolean, orden int)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_mes text;
begin
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede generar el archivo del banco';
  end if;
  select mes into v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if v_mes is null then raise exception 'Período inexistente'; end if;
  return query
  with visual as (
    select p.usuario_id uid, max(round(f.neto, 2)) neto
    from public.liquidacion_resultado_visual rv
    join public.liquidacion_resultado_fila f on f.resultado_id = rv.id
    join public.liquidacion_persona p on p.cuil = f.cuil
    where rv.periodo_id = p_periodo_id and rv.vigente and f.cuil is not null and p.usuario_id is not null
    group by p.usuario_id
  ),
  adel as (
    select a.empleado_id uid, round(sum(a.valor_liquidacion), 2) adel
    from public.liquidacion_ajuste a
    where a.periodo_id = p_periodo_id and a.clave = 'adelantos' and a.valor_liquidacion is not null
    group by a.empleado_id
  ),
  base as (
    select d.usuario_id id, d.cuenta cta, d.nombre nom, d.orden ord,
           round(public.sueldo_mensual_vigente(d.usuario_id, v_mes), 2) sm
    from public.pagos_banco_destinatarios() d
    where d.habilitado
  )
  select b.id, b.cta, b.nom,
         case when coalesce(b.sm, v.neto) is null then null
              else greatest(coalesce(b.sm, v.neto) - coalesce(a.adel, 0), 0) end,
         nullif(coalesce(a.adel, 0), 0),
         b.sm is not null,
         b.ord
  from base b left join visual v on v.uid = b.id left join adel a on a.uid = b.id
  where b.sm is not null or v.neto is not null
  order by b.ord, b.nom;
end;
$function$;
revoke all on function public.pagos_banco_por_usuario(uuid) from public, anon;
grant execute on function public.pagos_banco_por_usuario(uuid) to authenticated;

create function public.pagos_sueldos_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  return query
  select d.cuenta, d.nombre, d.sueldo
  from public.pagos_banco_por_usuario(p_periodo_id) d
  where d.sueldo is not null and d.sueldo <> 0
  order by d.orden, d.nombre;
end;
$function$;
revoke all on function public.pagos_sueldos_banco(uuid) from public, anon;
grant execute on function public.pagos_sueldos_banco(uuid) to authenticated;

-- Retirada: el archivo de extras lo arma la app desde la columna AP.
create function public.pagos_extras_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  raise exception 'pagos_extras_banco fue retirada: las extras se toman de la columna AP de la planilla (Excel de trabajo). Generá el archivo desde Liquidación → Pagos.';
end;
$function$;
revoke all on function public.pagos_extras_banco(uuid) from public, anon;
grant execute on function public.pagos_extras_banco(uuid) to authenticated;

-- 3) Registro de pagos efectivamente hechos (append-only; anular conserva historia).
create table if not exists public.liquidacion_pago_lote (
  id              uuid primary key default gen_random_uuid(),
  periodo_id      uuid not null references public.liquidacion_periodo(id) on delete restrict,
  tipo            text not null check (tipo in ('sueldos', 'extras')),
  archivo         text,
  hash            text not null,
  total           numeric not null,
  filas           int not null,
  registrado_por  uuid references public.usuarios(id) on delete set null,
  registrado_at   timestamptz not null default now(),
  anulado_at      timestamptz,
  anulado_por     uuid references public.usuarios(id) on delete set null,
  motivo_anulacion text,
  unique (periodo_id, tipo, hash)
);
create table if not exists public.liquidacion_pago_registrado (
  id          uuid primary key default gen_random_uuid(),
  lote_id     uuid not null references public.liquidacion_pago_lote(id) on delete restrict,
  periodo_id  uuid not null references public.liquidacion_periodo(id) on delete restrict,
  tipo        text not null check (tipo in ('sueldos', 'extras')),
  usuario_id  uuid not null references public.usuarios(id) on delete restrict,
  cuenta      text,
  importe     numeric not null check (importe > 0)
);
create index if not exists ix_liq_pago_reg_periodo on public.liquidacion_pago_registrado (periodo_id, tipo, usuario_id);

alter table public.liquidacion_pago_lote enable row level security;
alter table public.liquidacion_pago_registrado enable row level security;
revoke all on public.liquidacion_pago_lote from anon, authenticated;
revoke all on public.liquidacion_pago_registrado from anon, authenticated;
grant select on public.liquidacion_pago_lote to authenticated;
grant select on public.liquidacion_pago_registrado to authenticated;
drop policy if exists liq_pago_lote_lectura on public.liquidacion_pago_lote;
create policy liq_pago_lote_lectura on public.liquidacion_pago_lote for select to authenticated using (public.puede_liquidar_actual());
drop policy if exists liq_pago_registrado_lectura on public.liquidacion_pago_registrado;
create policy liq_pago_registrado_lectura on public.liquidacion_pago_registrado for select to authenticated using (public.puede_liquidar_actual());

-- Registrar como PAGADO un archivo del banco ya acreditado. Idempotente por hash
-- del archivo; atómico; identidad del que registra desde auth.uid().
create or replace function public.registrar_pago_banco(
  p_periodo_id uuid, p_tipo text, p_archivo text, p_hash text, p_filas jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_estado text;
  v_lote uuid;
  v_total numeric := 0;
  v_n int := 0;
  x jsonb;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede registrar pagos';
  end if;
  if p_tipo not in ('sueldos', 'extras') then raise exception 'Tipo de pago inválido'; end if;
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido'; end if;
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id for update;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado = 'anulado' then raise exception 'El período está anulado'; end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado = 'activo';

  select id into v_lote from public.liquidacion_pago_lote
   where periodo_id = p_periodo_id and tipo = p_tipo and hash = p_hash;
  if found then
    return jsonb_build_object('lote', v_lote, 'ya_registrado', true);
  end if;

  select coalesce(sum((f->>'importe')::numeric), 0), count(*) into v_total, v_n
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f;
  if v_n = 0 then raise exception 'El archivo no tiene filas para registrar'; end if;

  insert into public.liquidacion_pago_lote(periodo_id, tipo, archivo, hash, total, filas, registrado_por)
    values (p_periodo_id, p_tipo, p_archivo, p_hash, round(v_total, 2), v_n, v_actor) returning id into v_lote;
  for x in select * from jsonb_array_elements(p_filas) loop
    insert into public.liquidacion_pago_registrado(lote_id, periodo_id, tipo, usuario_id, cuenta, importe)
      values (v_lote, p_periodo_id, p_tipo, (x->>'usuario_id')::uuid, nullif(x->>'cuenta', ''), round((x->>'importe')::numeric, 2));
  end loop;
  return jsonb_build_object('lote', v_lote, 'ya_registrado', false, 'filas', v_n, 'total', round(v_total, 2));
end;
$fn$;
revoke all on function public.registrar_pago_banco(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.registrar_pago_banco(uuid,text,text,text,jsonb) to authenticated;

-- Anular un registro de pago (error de carga): conserva el lote y sus filas.
create or replace function public.anular_pago_banco(p_lote_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_uid uuid := auth.uid(); v_actor uuid;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede anular pagos';
  end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Motivo requerido'; end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado = 'activo';
  update public.liquidacion_pago_lote
     set anulado_at = now(), anulado_por = v_actor, motivo_anulacion = p_motivo
   where id = p_lote_id and anulado_at is null;
  if not found then raise exception 'Lote inexistente o ya anulado'; end if;
end;
$fn$;
revoke all on function public.anular_pago_banco(uuid,text) from public, anon;
grant execute on function public.anular_pago_banco(uuid,text) to authenticated;

commit;
