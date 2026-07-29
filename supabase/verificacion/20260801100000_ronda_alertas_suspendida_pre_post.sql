-- ============================================================================
-- VERIFICACIÓN — Suspensión de ronda por el vigilador
-- ============================================================================

-- 1. Estructura/permisos (después de aplicar).
select
  to_regprocedure('public.suspender_ronda(uuid, text)') is not null as fn_suspender_ok,
  (select conname is not null from pg_constraint
     where conname = 'ronda_alertas_tipo_check')                    as tipo_check_ok,
  exists (select 1 from information_schema.columns
     where table_name='ronda_alertas' and column_name='motivo_vigilador') as col_motivo_ok,
  has_function_privilege('authenticated','public.suspender_ronda(uuid, text)','execute') as auth_exec,   -- true
  has_function_privilege('anon','public.suspender_ronda(uuid, text)','execute')          as anon_exec;   -- false

-- 2. 'suspendida' admitido por el check. Esperado: sin error (rollback).
begin;
  insert into public.ronda_alertas (objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id,
    tipo, ventana_inicio, ventana_fin, vencimiento_at, estado)
  select e.objetivo_id, e.puesto_id, e.ronda_base_id, e.turno_id, e.guardia_id,
    'suspendida', now(), now(), now(), 'pendiente'
  from public.ronda_ejecuciones e limit 1;
rollback;

-- 3. Funcional: un vigilador con turno vigente suspende una ronda de su puesto.
--    Descubrir material:
select t.id turno_id, u.auth_user_id, rb.id ronda_base_id, rb.nombre
from public.turnos t
join public.usuarios u on u.id = t.guardia_id and u.auth_user_id is not null and u.estado='activo'
join public.rondas_base rb on rb.puesto_id = t.puesto_id and rb.activo
where t.puesto_id is not null
  and (now() at time zone 'America/Argentina/Buenos_Aires') between
      (t.fecha + t.hora_inicio) and
      (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
limit 5;

-- 3.1 Suspender (rollback). Esperado: contexto=suspendida, alerta_id no null,
--     y una fila ronda_alertas tipo=suspendida con motivo_vigilador.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"AUTH_USER_ID_DEL_VIGILADOR","role":"authenticated"}';
  select public.suspender_ronda('RONDA_BASE_ID', 'Atendiendo emergencia en el ingreso');
  select tipo, estado, motivo_vigilador from public.ronda_alertas
   where tipo='suspendida' order by created_at desc limit 1;
  -- Idempotencia: segunda llamada no crea otra fila
  select public.suspender_ronda('RONDA_BASE_ID', 'Sigo con la tarea');
  select count(*) from public.ronda_alertas where tipo='suspendida';
rollback;

-- 3.2 motivo corto. Esperado: contexto=motivo_invalido.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"AUTH_USER_ID_DEL_VIGILADOR","role":"authenticated"}';
  select public.suspender_ronda('RONDA_BASE_ID', 'x');
rollback;
