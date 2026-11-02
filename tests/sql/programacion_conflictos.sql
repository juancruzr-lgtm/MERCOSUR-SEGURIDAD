-- Pruebas de 20261113120000_programacion_conflictos_correccion_turnos.
--
-- Corre todo dentro de una transacción y termina en ROLLBACK: no deja datos.
-- Se puede ejecutar en un Postgres local (con tests/sql/esquema_minimo_programacion.sql,
-- ver scripts/test-sql-programacion.sh) o en una RAMA de Supabase. NUNCA en producción.
--
-- Cada bloque imprime "OK n - ..." o aborta con el caso que falló.
\set ON_ERROR_STOP on
begin;

create temp table _ids (k text primary key, v uuid);
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select v from _ids where _ids.k = $1 $$;
create or replace function pg_temp.como(k text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select u.auth_user_id from public.usuarios u where u.id = pg_temp.id(k)))::text, true)
$$;
-- Ejecuta y devuelve el mensaje de error (o null si no falló).
create or replace function pg_temp.error_de(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  z1 uuid := gen_random_uuid(); z2 uuid := gen_random_uuid();
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  insert into public.zonas_operativas (id, nombre) values (z1, 'Zona Test Norte'), (z2, 'Zona Test Sur');
  insert into _ids values ('z1', z1), ('z2', z2);
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado, puesto_organizacional)
    values (gen_random_uuid(), 'Ana', 'TEST ADMIN', 'admin', 'activo', 'administracion') returning id) insert into _ids select 'admin', id from x;
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado, puesto_organizacional)
    values (gen_random_uuid(), 'Sabino', 'TEST SUP', 'supervisor', 'activo', 'supervisor') returning id) insert into _ids select 'sup1', id from x;
  insert into public.supervisor_zonas (supervisor_id, zona_id) values (pg_temp.id('sup1'), z1);
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado)
    values (gen_random_uuid(), 'EDUARDO', 'TEST MARTINEZ', 'guardia', 'activo') returning id) insert into _ids select 'edu', id from x;
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado)
    values (gen_random_uuid(), 'NICOLAS', 'TEST GONZALEZ', 'guardia', 'activo') returning id) insert into _ids select 'g2', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('TEST SRT', 'activo', z1) returning id) insert into _ids select 'srt', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('TEST Polideportivo Lotuf', 'activo', z1) returning id) insert into _ids select 'lotuf', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('TEST Objetivo Sur', 'activo', z2) returning id) insert into _ids select 'sur', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre, activo) values (pg_temp.id('srt'), 'Principal', true) returning id) insert into _ids select 'p_srt', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre, activo) values (pg_temp.id('lotuf'), 'Principal', true) returning id) insert into _ids select 'p_lotuf', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre, activo) values (pg_temp.id('sur'), 'Principal', true) returning id) insert into _ids select 'p_sur', id from x;
end $$;

-- Helper: crea un turno y lo guarda con nombre.
create or replace function pg_temp.turno(k text, obj text, guardia text, f date, hi time, hf time) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento, guardia_original_id)
  values (pg_temp.id(guardia), pg_temp.id(obj), pg_temp.id('p_' || obj), f, hi, hf, 'programado', 'normal', pg_temp.id(guardia))
  returning id into v;
  insert into _ids values (k, v);
  return v;
end $$;

-- ── 5. Superposición real: A 07–15 / B 14–22 ────────────────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.turno('c5a', 'srt', 'g2', date '2030-03-04', '07:00', '15:00');
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-03-04', '14:00', '22:00', pg_temp.id('lotuf'), null);
  assert jsonb_array_length(r) = 1, r::text;
  assert r -> 0 ->> 'tipo' = 'superposicion', r::text;
  assert (r -> 0 ->> 'minutos_superpuestos')::int = 60, r::text;
  assert r -> 0 ->> 'objetivo' = 'TEST SRT' and r -> 0 ->> 'hora_inicio' = '07:00' and r -> 0 ->> 'hora_fin' = '15:00';
  raise notice 'OK 5 - superposicion 07-15 vs 14-22 = 60 min';
end $$;

-- ── 6. Consecutivos en distintos objetivos: A termina 15:00, B empieza 15:00 ─
do $$ declare r jsonb; begin
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-03-04', '15:00', '23:00', pg_temp.id('lotuf'), null);
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'tipo' = 'continuidad_inmediata', r::text;
  assert (r -> 0 ->> 'minutos_superpuestos')::int = 0;
  -- Mismo objetivo, consecutivo: no es "traslado imposible", queda como doble turno del día.
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-03-04', '15:00', '23:00', pg_temp.id('srt'), null);
  assert r -> 0 ->> 'tipo' = 'doble_turno_dia', r::text;
  raise notice 'OK 6 - continuidad inmediata en otro objetivo';
end $$;

-- ── 7. Dos turnos separados el mismo día: 07–13 / 18–23 ─────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.turno('c7a', 'srt', 'g2', date '2030-03-06', '07:00', '13:00');
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-03-06', '18:00', '23:00', pg_temp.id('lotuf'), null);
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'tipo' = 'doble_turno_dia' and r -> 0 ->> 'gravedad' = 'baja', r::text;
  -- Otro día sin contacto: nada.
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-03-07', '18:00', '23:00', pg_temp.id('lotuf'), null);
  assert jsonb_array_length(r) = 0, r::text;
  raise notice 'OK 7 - doble turno en el dia sin superposicion';
end $$;

-- ── 8. Cruce de medianoche: 29/10 19–07 vs 30/10 06–14 ──────────────────────
do $$ declare r jsonb; begin
  perform pg_temp.turno('c8a', 'srt', 'g2', date '2030-10-29', '19:00', '07:00');
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-10-30', '06:00', '14:00', pg_temp.id('lotuf'), null);
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'tipo' = 'superposicion', r::text;
  assert (r -> 0 ->> 'minutos_superpuestos')::int = 60, r::text;
  assert (r -> 0 ->> 'fecha')::date = date '2030-10-29', 'cuenta en su dia de inicio';
  -- 30/10 07–15 en otro objetivo: continuidad, no superposición.
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-10-30', '07:00', '15:00', pg_temp.id('lotuf'), null);
  assert r -> 0 ->> 'tipo' = 'continuidad_inmediata', r::text;
  -- Turno anulado: no cuenta.
  update public.turnos set estado = 'anulado' where id = pg_temp.id('c8a');
  r := public.conflictos_turno_vigilador_core(pg_temp.id('g2'), date '2030-10-30', '06:00', '14:00', pg_temp.id('lotuf'), null);
  assert jsonb_array_length(r) = 0, r::text;
  raise notice 'OK 8 - superposicion cruzando medianoche (1 h) y anulados excluidos';
end $$;

-- ── 13. Caso Eduardo Martínez 29/10: SRT 07–15 ya asignado, Lotuf 15–23 ─────
do $$ declare r jsonb; f jsonb; begin
  perform pg_temp.turno('e_srt', 'srt', 'edu', date '2030-10-29', '07:00', '15:00');
  insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento)
  values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-10-29', '15:00', '23:00', 'programado', 'normal')
  ;
end $$;
do $$ declare r jsonb; f jsonb; tid uuid; begin
  tid := (select id from public.turnos where objetivo_id = pg_temp.id('lotuf') and fecha = date '2030-10-29' and guardia_id is null);
  insert into _ids values ('e_lotuf', tid);
  perform pg_temp.como('admin');
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('edu'), array[tid], false);
  f := r -> 'filas' -> 0;
  assert f ->> 'resultado' = 'omitida' and (f ->> 'requiere_confirmacion')::boolean, r::text;
  assert f -> 'conflictos' -> 0 ->> 'tipo' = 'continuidad_inmediata', r::text;
  assert f -> 'conflicto' ->> 'objetivo' = 'TEST SRT', r::text;
  assert f ->> 'motivo' like 'Requiere confirmacion: TEST MARTINEZ, EDUARDO empieza inmediatamente despues de el turno de 07:00 a 15:00 en TEST SRT (Principal) el 29/10/2030.', f ->> 'motivo';
  assert (select guardia_id from public.turnos where id = tid) is null, 'no asigno sin confirmar';
  -- Confirmar sin motivo: rechazado.
  assert pg_temp.error_de(format('select public.asignar_vigilador_turnos(%L, %L, array[%L]::uuid[], false, true, %L)',
    gen_random_uuid(), pg_temp.id('edu'), tid, '')) like '%motivo es obligatorio%';
  -- Confirmar con motivo: asigna y deja constancia.
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('edu'), array[tid], false, true, 'Doble turno pedido por el cliente');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'asignada', r::text;
  assert (select count(*) from public.turnos_conflictos_confirmados where turno_id = tid and tipo = 'continuidad_inmediata'
          and motivo = 'Doble turno pedido por el cliente' and confirmado_por = pg_temp.id('admin')) = 1;
  assert (select count(*) from public.turnos_auditoria where turno_id = tid and campo = 'guardia_id'
          and comentario like '%conflicto confirmado%') = 1;
  raise notice 'OK 13 - caso Eduardo Martinez: advierte continuidad, asigna solo con motivo y deja constancia';
end $$;

-- ── 9. Conflicto entre zonas: el supervisor de la zona Norte ve el turno de la Sur ─
do $$ declare r jsonb; tid uuid; begin
  perform pg_temp.turno('z_sur', 'sur', 'g2', date '2030-05-10', '06:00', '14:00');
  insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values
    (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-05-10', '12:00', '20:00') returning id into tid;
  perform pg_temp.como('sup1');
  r := public.conflictos_turno_vigilador(tid, pg_temp.id('g2'));
  assert r -> 'conflictos' -> 0 ->> 'objetivo' = 'TEST Objetivo Sur', r::text;
  assert r -> 'conflictos' -> 0 ->> 'tipo' = 'superposicion' and (r -> 'conflictos' -> 0 ->> 'minutos_superpuestos')::int = 120, r::text;
  assert not (r ->> 'puede_confirmar_superposicion')::boolean;
  -- El supervisor no puede confirmar una superposición; Administración sí.
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('g2'), array[tid], false, true, 'Lo pide el cliente');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'omitida' and r -> 'filas' -> 0 ->> 'motivo' like 'Superposicion horaria: solo Administracion%', r::text;
  perform pg_temp.como('admin');
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('g2'), array[tid], false, true, 'Cubre 2 h hasta el relevo');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'asignada', r::text;
  -- El supervisor tampoco consulta turnos de objetivos fuera de su zona.
  perform pg_temp.como('sup1');
  assert pg_temp.error_de(format('select public.conflictos_turno_vigilador(%L, %L)', pg_temp.id('z_sur'), pg_temp.id('edu'))) = 'Objetivo fuera de tu alcance';
  raise notice 'OK 9 - conflicto entre zonas detectado; superposicion solo la confirma Administracion';
end $$;

-- ── 1. Anular un turno futuro ───────────────────────────────────────────────
do $$ declare r jsonb; tid uuid; begin
  tid := pg_temp.turno('a1', 'lotuf', 'g2', (now() at time zone 'America/Argentina/Buenos_Aires')::date + 5, '07:00', '15:00');
  perform pg_temp.como('sup1');
  r := public.corregir_turno_programacion(gen_random_uuid(), tid, 'evaluar');
  assert r -> 'evidencia' ->> 'clase' = 'futuro' and (r -> 'evidencia' ->> 'puede_anular')::boolean, r::text;
  assert pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L)', gen_random_uuid(), tid, 'anular', 'x'))
    like 'El motivo es obligatorio%';
  r := public.corregir_turno_programacion(gen_random_uuid(), tid, 'anular', 'Cargado en el objetivo equivocado');
  assert (select estado from public.turnos where id = tid) = 'anulado';
  assert (select count(*) from public.turnos_correcciones where turno_id = tid and accion = 'anular_error_programacion'
          and clase_evidencia = 'futuro' and antes ->> 'estado' = 'programado' and despues ->> 'estado' = 'anulado'
          and actor_id = pg_temp.id('sup1')) = 1;
  assert (select count(*) from public.turnos_auditoria where turno_id = tid and campo = 'estado' and valor_nuevo = 'anulado') = 1;
  assert (select count(*) from public.turnos where id = tid) = 1, 'no se borra fisicamente';
  raise notice 'OK 1 - anular turno futuro (supervisor de la zona)';
end $$;

-- ── 2. Anular un turno cuyo horario empezó (y terminó) sin fichaje ──────────
do $$ declare r jsonb; tid uuid; begin
  tid := pg_temp.turno('a2', 'lotuf', 'edu', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, '15:00', '23:00');
  insert into public.notificaciones_enviadas (usuario_id, turno_id, tipo) values (pg_temp.id('admin'), tid, 'escalamiento_wa_15');
  insert into public.escalamiento_whatsapp_envios (turno_id, nivel) values (tid, 'escalamiento_wa_15'), (tid, 'escalamiento_wa_30');
  perform pg_temp.como('admin');
  r := public.corregir_turno_programacion(gen_random_uuid(), tid, 'evaluar');
  assert r -> 'evidencia' ->> 'clase' = 'iniciado_sin_fichaje' and (r -> 'evidencia' ->> 'horario_finalizado')::boolean, r::text;
  r := public.corregir_turno_programacion(gen_random_uuid(), tid, 'anular', 'Turno duplicado: el puesto lo cubrio otro vigilador');
  assert (select estado from public.turnos where id = tid) = 'anulado', 'anulado, no ausente';
  assert (r -> 'impacto' -> 'alertas' -> 'ya_emitidas' ->> 'whatsapp')::int = 2, r::text;
  assert (select count(*) from public.registros_asistencia where turno_id = tid) = 0, 'no inventa ausencia';
  assert (select count(*) from public.notificaciones_enviadas where turno_id = tid) = 1, 'las ya emitidas se conservan';
  raise notice 'OK 2 - anular turno iniciado sin fichaje';
end $$;

-- ── 3. Intentar anular un turno con fichaje: solo solicitud ─────────────────
do $$ declare r jsonb; tid uuid; e text; begin
  tid := pg_temp.turno('a3', 'srt', 'edu', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, '07:00', '15:00');
  insert into public.registros_asistencia (turno_id, guardia_id, tipo_registro, hora_entrada_real)
  values (tid, pg_temp.id('edu'), 'fichaje_gps', '06:30');
  perform pg_temp.como('admin');
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L)', gen_random_uuid(), tid, 'anular', 'Error de carga'));
  assert e like 'REQUIERE_SOLICITUD%con_entrada%', e;
  r := public.corregir_turno_programacion(gen_random_uuid(), tid, 'solicitar_correccion', 'El horario real fue 06:30 a 14:00');
  assert (select count(*) from public.turnos_correcciones where turno_id = tid and accion = 'solicitud_correccion' and estado = 'pendiente') = 1;
  assert (select estado from public.turnos where id = tid) = 'programado';
  assert (select count(*) from public.registros_asistencia where turno_id = tid and hora_entrada_real = '06:30') = 1;
  raise notice 'OK 3 - turno con fichaje no se anula; queda solicitud y registros intactos';
end $$;

-- ── 4. Modificar un turno iniciado sin evidencia ────────────────────────────
do $$ declare r jsonb; tid uuid; e text; v timestamptz; begin
  tid := pg_temp.turno('a4', 'lotuf', 'g2', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, '08:00', '16:00');
  perform pg_temp.turno('a4b', 'srt', 'g2', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, '17:00', '23:00');
  perform pg_temp.como('admin');
  v := (select updated_at from public.turnos where id = tid);
  -- 08–17 toca el turno de las 17 en otro objetivo: pide confirmación.
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L, %L, %L, %L)',
    gen_random_uuid(), tid, 'modificar_horario', 'Se extendio el servicio', '08:00', '17:00', v));
  assert e like 'Requiere confirmacion%', e;
  r := public.corregir_turno_programacion(gen_random_uuid(), tid, 'modificar_horario', 'Se extendio el servicio', '08:00', '17:00', v, true);
  assert (select hora_fin from public.turnos where id = tid) = '17:00';
  assert (select count(*) from public.turnos_conflictos_confirmados where turno_id = tid and origen = 'modificacion_horario') = 1;
  assert (select count(*) from public.turnos_auditoria where turno_id = tid and campo in ('hora_inicio','hora_fin')) = 2;
  raise notice 'OK 4 - modificar turno iniciado sin evidencia, con conflicto confirmado';
end $$;

-- ── 11. Horas liquidadas / revisadas / período cerrado ──────────────────────
do $$ declare tid uuid; e text; begin
  tid := pg_temp.turno('a11', 'lotuf', 'edu', date '2030-10-29', '15:00', '23:00');
  update public.turnos set estado = 'cubierto' where id = tid;
  insert into public.registros_asistencia (turno_id, guardia_id, tipo_registro, horas_liquidables, origen_cobertura)
  values (tid, pg_temp.id('edu'), 'carga_manual', 8, 'confirmacion_supervisor');
  perform pg_temp.como('admin');
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L)', gen_random_uuid(), tid, 'anular', 'Carga manual erronea'));
  assert e like 'REQUIERE_SOLICITUD%con_horas%', e;
  insert into public.revisiones_planilla (turno_id) values (tid);
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L)', gen_random_uuid(), tid, 'anular', 'Carga manual erronea'));
  assert e like 'REQUIERE_SOLICITUD%horas_revisadas%', e;
  insert into public.liquidacion_periodo (mes, estado) values ('2030-10', 'liquidada');
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L)', gen_random_uuid(), tid, 'solicitar_correccion', 'Carga manual erronea'));
  assert e like 'PERIODO_CERRADO%', e;
  assert (select horas_liquidables from public.registros_asistencia where turno_id = tid) = 8, 'horas intactas';
  assert (select estado from public.turnos where id = tid) = 'cubierto';
  raise notice 'OK 11 - horas con evidencia/revisadas/liquidadas no se borran en silencio';
end $$;

-- ── 12. Modificaciones simultáneas e idempotencia ───────────────────────────
do $$ declare r jsonb; tid uuid; e text; v timestamptz; op uuid := gen_random_uuid(); begin
  tid := pg_temp.turno('a12', 'lotuf', 'g2', (now() at time zone 'America/Argentina/Buenos_Aires')::date + 9, '07:00', '15:00');
  perform pg_temp.como('admin');
  v := (select updated_at from public.turnos where id = tid);
  update public.turnos set hora_fin = '14:00' where id = tid;  -- otra persona lo cambió
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L, null, null, %L)', gen_random_uuid(), tid, 'anular', 'Error de carga', v));
  assert e like 'CONCURRENCIA%', e;
  r := public.corregir_turno_programacion(op, tid, 'anular', 'Error de carga');
  r := public.corregir_turno_programacion(op, tid, 'anular', 'Error de carga');
  assert (r ->> 'repetida')::boolean, r::text;
  assert (select count(*) from public.turnos_correcciones where operacion_id = op) = 1;
  assert (select count(*) from public.turnos_auditoria where turno_id = tid and valor_nuevo = 'anulado') = 1;
  raise notice 'OK 12 - concurrencia detectada por version; reintento idempotente';
end $$;

-- ── 10. Después de anular no hay obligación de rondas ───────────────────────
do $$ declare tid uuid; rb uuid; n int; begin
  tid := pg_temp.turno('a10', 'lotuf', 'g2', date '2030-06-01', '08:00', '16:00');
  insert into public.rondas_base (puesto_id, hora_inicio, intervalo_minutos) values (pg_temp.id('p_lotuf'), null, 120) returning id into rb;
  insert into public.ronda_puntos (ronda_base_id) values (rb);
  n := (select count(*) from public.rondas_ventanas_programadas(pg_temp.id('lotuf'), date '2030-06-01', date '2030-06-01') where turno_id = tid);
  assert n = 4, 'antes: 4 ventanas, hay ' || n;
  update public.turnos set estado = 'anulado' where id = tid;
  n := (select count(*) from public.rondas_ventanas_programadas(pg_temp.id('lotuf'), date '2030-06-01', date '2030-06-01') where turno_id = tid);
  assert n = 0, 'anulado: sin ventanas, hay ' || n;
  raise notice 'OK 10 - turno anulado no exige rondas (no genera alertas ni cuenta en la evaluacion)';
end $$;

-- ── Permisos: el vigilador no corrige ni consulta ───────────────────────────
do $$ begin
  perform pg_temp.como('edu');
  assert pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L)', gen_random_uuid(), pg_temp.id('a3'), 'anular', 'me equivoque'))
    like 'No autorizado%';
  assert pg_temp.error_de(format('select public.conflictos_turno_vigilador(%L, %L)', pg_temp.id('a3'), pg_temp.id('edu'))) = 'No autorizado';
  -- Supervisor fuera de zona no corrige.
  perform pg_temp.como('sup1');
  assert pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L)', gen_random_uuid(), pg_temp.id('z_sur'), 'evaluar')) = 'Objetivo fuera de tu alcance';
  raise notice 'OK P - vigilador sin capacidad de anular; supervisor limitado a su zona';
end $$;

-- ── Alta para hoy queda auditada ────────────────────────────────────────────
do $$ declare tid uuid; begin
  perform pg_temp.como('sup1');
  insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin)
  values (pg_temp.id('g2'), pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), (now() at time zone 'America/Argentina/Buenos_Aires')::date, '15:00', '23:00')
  returning id into tid;
  assert (select count(*) from public.turnos_auditoria where turno_id = tid and campo = 'alta' and modificado_por = pg_temp.id('sup1')) = 1;
  raise notice 'OK A - alta de turno del dia queda auditada con su autor';
end $$;

rollback;
