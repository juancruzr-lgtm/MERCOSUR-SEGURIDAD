-- Integración #345 + #346: turnos_validar_superposicion (20261121120000) con la
-- confirmación de conflictos de programación (20261113110000).
--
-- Requiere: tests/sql/esquema_minimo_programacion.sql, asignar_vigilador_turnos
-- previo, 20261113110000 y la sección 3 de 20261121120000 (función + trigger).
-- Ver scripts/test-sql-integracion.mjs. NUNCA en producción. Termina en ROLLBACK.
\set ON_ERROR_STOP on
begin;

create temp table _ids (k text primary key, v uuid);
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select v from _ids where _ids.k = $1 $$;
create or replace function pg_temp.como(k text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select u.auth_user_id from public.usuarios u where u.id = pg_temp.id(k)))::text, true)
$$;
create or replace function pg_temp.error_de(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare z1 uuid := gen_random_uuid();
begin
  insert into public.zonas_operativas (id, nombre) values (z1, 'Zona Test');
  insert into _ids values ('z1', z1);
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado, puesto_organizacional)
    values (gen_random_uuid(), 'Ana', 'TEST ADMIN', 'admin', 'activo', 'administracion') returning id) insert into _ids select 'admin', id from x;
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado, puesto_organizacional)
    values (gen_random_uuid(), 'Sabino', 'TEST SUP', 'supervisor', 'activo', 'supervisor') returning id) insert into _ids select 'sup1', id from x;
  insert into public.supervisor_zonas (supervisor_id, zona_id) values (pg_temp.id('sup1'), z1);
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado)
    values (gen_random_uuid(), 'EDUARDO', 'TEST MARTINEZ', 'guardia', 'activo') returning id) insert into _ids select 'g', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('TEST SRT', 'activo', z1) returning id) insert into _ids select 'srt', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('TEST Lotuf', 'activo', z1) returning id) insert into _ids select 'lotuf', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre, activo) values (pg_temp.id('srt'), 'Principal', true) returning id) insert into _ids select 'p_srt', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre, activo) values (pg_temp.id('lotuf'), 'Principal', true) returning id) insert into _ids select 'p_lotuf', id from x;
end $$;

create or replace function pg_temp.turno(k text, obj text, guardia text, f date, hi time, hf time) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento, guardia_original_id)
  values (pg_temp.id(guardia), pg_temp.id(obj), pg_temp.id('p_' || obj), f, hi, hf, 'programado', 'normal', pg_temp.id(guardia))
  returning id into v;
  insert into _ids values (k, v);
  return v;
end $$;

do $$ begin
  perform pg_temp.turno('t1', 'srt', 'g', date '2030-06-01', '07:00', '15:00');
  -- Alta directa superpuesta (PostgREST / grilla vieja): el trigger la frena.
  assert pg_temp.error_de(format(
    'insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento) values (%L, %L, %L, %L, %L, %L, %L, %L)',
    pg_temp.id('g'), pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-06-01', '14:00', '22:00', 'programado', 'normal')) like 'TURNO_SUPERPUESTO%';
  raise notice 'OK I1 - alta directa superpuesta rechazada por el trigger';
end $$;

do $$ declare r jsonb; tid uuid; begin
  insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento)
  values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-06-01', '14:00', '22:00', 'programado', 'normal') returning id into tid;
  insert into _ids values ('t2', tid);

  perform pg_temp.como('sup1');
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('g'), array[tid], false, true, 'Lo pide el cliente');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'omitida' and r -> 'filas' -> 0 ->> 'motivo' like 'Superposicion horaria: solo Administracion%', r::text;
  raise notice 'OK I2 - el supervisor no confirma una superposicion';

  perform pg_temp.como('admin');
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('g'), array[tid], false, false, null);
  assert r -> 'filas' -> 0 ->> 'resultado' = 'omitida' and (r -> 'filas' -> 0 ->> 'requiere_confirmacion')::boolean, r::text;
  assert (select guardia_id from public.turnos where id = tid) is null;
  raise notice 'OK I3 - sin confirmacion no se asigna';

  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('g'), array[tid], false, true, 'Cubre 1 h hasta el relevo');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'asignada', r::text;
  assert (select guardia_id from public.turnos where id = tid) = pg_temp.id('g');
  assert (select count(*) from public.turnos_conflictos_confirmados
          where turno_id = tid and turno_conflicto_id = pg_temp.id('t1') and tipo = 'superposicion' and origen = 'asignacion') = 1;
  raise notice 'OK I4 - Administracion confirma la superposicion con motivo: el trigger la deja pasar y queda constancia';
end $$;

do $$ declare tid uuid; begin
  -- Otro turno sin constancia para ese par: sigue bloqueado aunque el vigilador
  -- ya tenga una superposición confirmada con otro turno.
  insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento)
  values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-06-01', '09:00', '11:00', 'programado', 'normal') returning id into tid;
  assert pg_temp.error_de(format('update public.turnos set guardia_id = %L where id = %L', pg_temp.id('g'), tid)) like 'TURNO_SUPERPUESTO%';
  raise notice 'OK I5 - la constancia vale solo para el par confirmado';
end $$;

do $$ declare r jsonb; v timestamptz; begin
  perform pg_temp.turno('t3', 'srt', 'g', date '2030-06-02', '08:00', '12:00');
  perform pg_temp.turno('t4', 'lotuf', 'g', date '2030-06-02', '16:00', '20:00');
  perform pg_temp.como('admin');
  select updated_at into v from public.turnos where id = pg_temp.id('t4');
  assert pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L, %L, %L, %L)',
    gen_random_uuid(), pg_temp.id('t4'), 'modificar_horario', 'Se adelanta el servicio', '11:00', '20:00', v)) like 'Requiere confirmacion%';
  r := public.corregir_turno_programacion(gen_random_uuid(), pg_temp.id('t4'), 'modificar_horario', 'Se adelanta el servicio', '11:00', '20:00', v, true);
  assert (select hora_inicio from public.turnos where id = pg_temp.id('t4')) = '11:00'::time, r::text;
  assert (select count(*) from public.turnos_conflictos_confirmados
          where turno_id = pg_temp.id('t4') and turno_conflicto_id = pg_temp.id('t3') and origen = 'modificacion_horario') = 1;
  raise notice 'OK I6 - cambio de horario con superposicion confirmada pasa el trigger';
end $$;

do $$ declare r jsonb; tid uuid; begin
  -- Continuidad inmediata (15-23 después de 07-15): advertencia de programación,
  -- el trigger no la bloquea.
  perform pg_temp.turno('t5', 'srt', 'g', date '2030-06-03', '07:00', '15:00');
  insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, tipo_evento)
  values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-06-03', '15:00', '23:00', 'programado', 'normal') returning id into tid;
  perform pg_temp.como('sup1');
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('g'), array[tid], false, true, 'Doble turno pedido');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'asignada', r::text;
  raise notice 'OK I7 - continuidad confirmada por el supervisor: asignada';
end $$;

rollback;
