-- Integración #345 + #346: la superposición se bloquea siempre (decisión de JC, 02/11/2026).
-- Corre sobre supabase/pruebas/turnos-cobertura/prelude.sql (esqueleto de producción de #345),
-- con 20261121120000 (trigger de superposición) y 20261125120000 (programación) aplicadas.
-- Ver scripts/test-sql-pglite.mjs. Termina en ROLLBACK.

create table if not exists public.revisiones_planilla (id uuid primary key default gen_random_uuid(), turno_id uuid not null);
create table if not exists public.liquidacion_periodo (id uuid primary key default gen_random_uuid(), mes text, estado text);
create table if not exists public.notificaciones_enviadas (id uuid primary key default gen_random_uuid(), usuario_id uuid, turno_id uuid, tipo text, created_at timestamptz default now());
create table if not exists public.escalamiento_whatsapp_envios (id uuid primary key default gen_random_uuid(), turno_id uuid, nivel text, created_at timestamptz default now());
create table if not exists public.ronda_alertas (id uuid primary key default gen_random_uuid(), turno_id uuid, estado text default 'pendiente');
create table if not exists public.app_config (key text primary key, value text);

begin;
create temp table _ids (k text primary key, v uuid);
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select v from _ids where _ids.k = $1 $$;
-- El esqueleto de #345 lee el usuario de request.jwt.claim.sub.
create or replace function pg_temp.como(k text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select u.auth_user_id::text from public.usuarios u where u.id = pg_temp.id(k)), true) $$;
create or replace function pg_temp.error_de(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$ declare z uuid := gen_random_uuid(); begin
  insert into public.zonas_operativas (id, nombre) values (z, 'Norte');
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado, puesto_organizacional)
    values (gen_random_uuid(), 'Ana', 'ADMIN', 'admin', 'activo', 'administracion') returning id) insert into _ids select 'admin', id from x;
  with x as (insert into public.usuarios (auth_user_id, nombre, apellido, rol, estado)
    values (gen_random_uuid(), 'EDUARDO', 'MARTINEZ', 'guardia', 'activo') returning id) insert into _ids select 'edu', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('SRT', 'activo', z) returning id) insert into _ids select 'srt', id from x;
  with x as (insert into public.objetivos (nombre, estado, zona_id) values ('Lotuf', 'activo', z) returning id) insert into _ids select 'lotuf', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre) values (pg_temp.id('srt'), 'Principal') returning id) insert into _ids select 'p_srt', id from x;
  with x as (insert into public.puestos (objetivo_id, nombre) values (pg_temp.id('lotuf'), 'Principal') returning id) insert into _ids select 'p_lotuf', id from x;
  -- Eduardo: SRT 07–15 asignado; Lotuf 15–23 y 14–22 vacíos (2030, futuro).
  with x as (insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin)
    values (pg_temp.id('edu'), pg_temp.id('srt'), pg_temp.id('p_srt'), date '2030-10-29', '07:00', '15:00') returning id) insert into _ids select 't_srt', id from x;
  with x as (insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin)
    values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-10-29', '15:00', '23:00') returning id) insert into _ids select 't_lotuf', id from x;
  with x as (insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin)
    values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-10-30', '06:00', '14:00') returning id) insert into _ids select 't_dia2', id from x;
  with x as (insert into public.turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin)
    values (pg_temp.id('lotuf'), pg_temp.id('p_lotuf'), date '2030-10-29', '14:00', '22:00') returning id) insert into _ids select 't_sup', id from x;
end $$;

do $$ declare r jsonb; begin
  perform pg_temp.como('admin');
  -- Continuidad inmediata (07–15 / 15–23): la RPC pide confirmación y, con
  -- motivo, el trigger de #345 la deja pasar (no se superponen).
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('edu'), array[pg_temp.id('t_lotuf')], false);
  assert (r -> 'filas' -> 0 ->> 'requiere_confirmacion')::boolean, r::text;
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('edu'), array[pg_temp.id('t_lotuf')], false, true, 'Doble turno pedido por el cliente');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'asignada', r::text;
  assert (select count(*) from public.turnos_conflictos_confirmados where turno_id = pg_temp.id('t_lotuf')) = 1;
  raise notice 'OK C1 - continuidad confirmada con motivo convive con el trigger de superposicion';
end $$;

do $$ declare r jsonb; e text; begin
  perform pg_temp.como('admin');
  -- Superposición (14–22 contra 07–15 y 15–23): la RPC la rechaza aun confirmada.
  r := public.asignar_vigilador_turnos(gen_random_uuid(), pg_temp.id('edu'), array[pg_temp.id('t_sup')], false, true, 'Lo pide el cliente');
  assert r -> 'filas' -> 0 ->> 'resultado' = 'omitida' and r -> 'filas' -> 0 ->> 'motivo' like 'Superposicion horaria:%', r::text;
  -- Escritura directa (lo que hace /api/turnos/editar): el trigger de #345 la frena con 23P01.
  e := pg_temp.error_de(format('update public.turnos set guardia_id = %L where id = %L', pg_temp.id('edu'), pg_temp.id('t_sup')));
  assert e like 'TURNO_SUPERPUESTO%', e;
  assert (select guardia_id from public.turnos where id = pg_temp.id('t_sup')) is null;
  raise notice 'OK C2 - superposicion rechazada por la RPC y por el trigger (escritura directa)';
end $$;

do $$ declare r jsonb; e text; begin
  perform pg_temp.como('admin');
  -- Corrección de horario que genera superposición: rechazada por la RPC.
  e := pg_temp.error_de(format('select public.corregir_turno_programacion(%L, %L, %L, %L, %L, %L, null, true)',
    gen_random_uuid(), pg_temp.id('t_lotuf'), 'modificar_horario', 'Extiende el servicio', '14:00', '23:00'));
  assert e like 'Superposicion horaria%', e;
  -- Anular el turno erróneo (futuro, sin evidencia): queda anulado y el historial de #345 lo registra.
  r := public.corregir_turno_programacion(gen_random_uuid(), pg_temp.id('t_lotuf'), 'anular', 'Turno duplicado: lo cubre otro vigilador');
  assert (select estado from public.turnos where id = pg_temp.id('t_lotuf')) = 'anulado';
  assert (select count(*) from public.turnos_historial where turno_id = pg_temp.id('t_lotuf')) >= 1, 'turnos_historial (#345) registra la anulacion';
  assert (select count(*) from public.turnos_correcciones where turno_id = pg_temp.id('t_lotuf') and accion = 'anular_error_programacion') = 1;
  -- Anulado ya no cuenta: el 14–22 sigue chocando con SRT 07–15, pero el 15–23 anulado no aparece.
  r := public.conflictos_turno_vigilador_core(pg_temp.id('edu'), date '2030-10-29', '14:00', '22:00', pg_temp.id('lotuf'), pg_temp.id('t_sup'));
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'turno_id' = pg_temp.id('t_srt')::text, r::text;
  raise notice 'OK C3 - correccion: superposicion rechazada; anulado registrado en historial y excluido de conflictos';
end $$;

rollback;
