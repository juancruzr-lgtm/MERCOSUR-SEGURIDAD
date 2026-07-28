-- ============================================================================
-- VERIFICACIÓN — Correctivo Rondas C1/C4
-- ============================================================================
--
-- Acompaña a:
--   supabase/migrations/20260728234500_rondas_correctivo_c1_c4.sql
--
-- La sección 1 es la precondición de solo lectura y puede ejecutarse antes de
-- aplicar. El archivo completo se ejecuta después de aplicar.
--
-- Todas las pruebas que escriben datos están encerradas en transacciones que
-- terminan con ROLLBACK. No prueba concurrencia real: las llamadas de este
-- verificador son deliberadamente secuenciales.
-- ============================================================================


-- ── 1. Precondición de datos (solo lectura) ──────────────────────────────────

select
  (select count(*)
     from public.ronda_puntos
    where gps_requerido
      and (latitud is null or longitud is null or radio_metros is null))
    as ronda_puntos_invalidos,
  (select count(*)
     from public.ronda_ejecucion_puntos
    where snap_gps_requerido
      and (
        snap_latitud is null
        or snap_longitud is null
        or snap_radio_metros is null
      ))
    as snapshots_invalidos;

-- Esperado antes y después: 0 · 0.

do $$
declare
  v_ronda_puntos_invalidos  bigint;
  v_snapshots_invalidos     bigint;
begin
  select count(*) into v_ronda_puntos_invalidos
    from public.ronda_puntos
   where gps_requerido
     and (latitud is null or longitud is null or radio_metros is null);

  select count(*) into v_snapshots_invalidos
    from public.ronda_ejecucion_puntos
   where snap_gps_requerido
     and (
       snap_latitud is null
       or snap_longitud is null
       or snap_radio_metros is null
     );

  if v_ronda_puntos_invalidos > 0 or v_snapshots_invalidos > 0 then
    raise exception
      'PRECONDICIÓN FALLIDA: public.ronda_puntos=% registro(s), public.ronda_ejecucion_puntos=% snapshot(s); se requiere saneamiento previo',
      v_ronda_puntos_invalidos,
      v_snapshots_invalidos;
  end if;

  raise notice 'OK: precondición GPS sin filas inválidas';
end;
$$;


-- ── 2. Estructura, validación y permisos ────────────────────────────────────

do $$
declare
  v_base_def text;
  v_snap_def text;
begin
  select pg_get_constraintdef(oid)
    into v_base_def
    from pg_constraint
   where conrelid = 'public.ronda_puntos'::regclass
     and conname = 'ronda_puntos_gps_config_completa';

  if v_base_def is null then
    raise exception 'FALLO: falta ronda_puntos_gps_config_completa';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.ronda_puntos'::regclass
       and conname = 'ronda_puntos_gps_config_completa'
       and contype = 'c'
       and convalidated
  ) then
    raise exception 'FALLO: ronda_puntos_gps_config_completa no está validada';
  end if;

  select pg_get_constraintdef(oid)
    into v_snap_def
    from pg_constraint
   where conrelid = 'public.ronda_ejecucion_puntos'::regclass
     and conname = 'ronda_ejecucion_puntos_snap_gps_config_completa'
     and contype = 'c'
     and convalidated;

  if v_snap_def is null then
    raise exception 'FALLO: falta o no está validada la restricción de snapshot GPS';
  end if;

  if v_base_def !~* 'gps_requerido'
     or v_base_def !~* 'latitud IS NOT NULL'
     or v_base_def !~* 'longitud IS NOT NULL'
     or v_base_def !~* 'radio_metros IS NOT NULL' then
    raise exception 'FALLO: definición inesperada en restricción GPS base';
  end if;

  if v_snap_def !~* 'snap_gps_requerido'
     or v_snap_def !~* 'snap_latitud IS NOT NULL'
     or v_snap_def !~* 'snap_longitud IS NOT NULL'
     or v_snap_def !~* 'snap_radio_metros IS NOT NULL' then
    raise exception 'FALLO: definición inesperada en restricción GPS snapshot';
  end if;

  raise notice 'OK: ambas restricciones existen, están validadas y contienen la invariante completa';
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.iniciar_ronda(uuid)', 'EXECUTE')
     or has_function_privilege(
       'anon',
       'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)',
       'EXECUTE'
     ) then
    raise exception 'FALLO: anon conserva EXECUTE sobre una RPC corregida';
  end if;

  if not has_function_privilege('authenticated', 'public.iniciar_ronda(uuid)', 'EXECUTE')
     or not has_function_privilege(
       'authenticated',
       'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)',
       'EXECUTE'
     ) then
    raise exception 'FALLO: authenticated no puede ejecutar las RPC corregidas';
  end if;

  if not exists (
    select 1
      from pg_proc
     where oid = 'public.iniciar_ronda(uuid)'::regprocedure
       and prosecdef
       and proconfig @> array['search_path=public, pg_catalog']
  ) then
    raise exception 'FALLO: iniciar_ronda perdió SECURITY DEFINER o search_path';
  end if;

  if not exists (
    select 1
      from pg_proc
     where oid = 'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)'::regprocedure
       and prosecdef
       and proconfig @> array['search_path=public, storage, pg_catalog']
  ) then
    raise exception 'FALLO: registrar_punto_ronda perdió SECURITY DEFINER o search_path';
  end if;

  raise notice 'OK: permisos, SECURITY DEFINER y search_path';
end;
$$;


-- ── 3. Restricciones, C4 y defensa ante snapshot legado ─────────────────────

begin;

create temp table _ctx on commit drop as
select
  u.auth_user_id,
  u.id as guardia_id,
  t.id as turno_id,
  t.objetivo_id,
  t.puesto_id
from public.turnos t
join public.usuarios u on u.id = t.guardia_id and u.estado = 'activo'
where u.auth_user_id is not null
  and t.puesto_id is not null
  and t.fecha in (
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1))
  and (t.fecha + t.hora_inicio) <= (now() at time zone 'America/Argentina/Buenos_Aires')
  and (now() at time zone 'America/Argentina/Buenos_Aires') < (
        t.fecha + t.hora_fin
        + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
  and not exists (
    select 1
      from public.ronda_ejecuciones e
     where e.turno_id = t.id
       and e.guardia_id = u.id
       and e.estado = 'en_curso')
limit 1;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception
      'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente y sin ejecución abierta';
  end if;
end;
$$;

create temp table _rondas (clave text primary key, id uuid not null) on commit drop;

with creada as (
  insert into public.rondas_base (
    objetivo_id, puesto_id, nombre, intervalo_minutos, activo
  )
  select
    objetivo_id,
    puesto_id,
    'ZZZ verificación C1C4 A ' || left(gen_random_uuid()::text, 8),
    60,
    true
  from _ctx
  returning id
)
insert into _rondas
select 'a', id from creada;

with creada as (
  insert into public.rondas_base (
    objetivo_id, puesto_id, nombre, intervalo_minutos, activo
  )
  select
    objetivo_id,
    puesto_id,
    'ZZZ verificación C1C4 B ' || left(gen_random_uuid()::text, 8),
    60,
    true
  from _ctx
  returning id
)
insert into _rondas
select 'b', id from creada;

-- INSERT inválido rechazado por la restricción base.
do $$
declare
  v_constraint text;
begin
  begin
    insert into public.ronda_puntos (
      ronda_base_id, nombre, orden, foto_requerida, gps_requerido, activo
    )
    values (
      (select id from _rondas where clave = 'a'),
      'GPS incompleto insert',
      90,
      false,
      true,
      true
    );
    raise exception 'FALLO: INSERT GPS incompleto aceptado';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'ronda_puntos_gps_config_completa' then
      raise;
    end if;
  end;
  raise notice 'OK: INSERT GPS incompleto rechazado';
end;
$$;

-- GPS no requerido sin coordenadas: aceptado.
insert into public.ronda_puntos (
  ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
  latitud, longitud, radio_metros, activo
)
values (
  (select id from _rondas where clave = 'a'),
  'GPS opcional',
  1,
  false,
  false,
  null,
  null,
  null,
  true
);

-- GPS requerido con configuración completa: aceptado.
insert into public.ronda_puntos (
  ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
  latitud, longitud, radio_metros, activo
)
values (
  (select id from _rondas where clave = 'a'),
  'GPS completo',
  2,
  false,
  true,
  -34.60,
  -58.40,
  100,
  true
);

insert into public.ronda_puntos (
  ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
  latitud, longitud, radio_metros, activo
)
values (
  (select id from _rondas where clave = 'b'),
  'Otra ronda',
  1,
  false,
  false,
  null,
  null,
  null,
  true
);

-- UPDATE inválido rechazado por la restricción base.
do $$
declare
  v_constraint text;
begin
  begin
    update public.ronda_puntos
       set gps_requerido = true
     where ronda_base_id = (select id from _rondas where clave = 'a')
       and orden = 1;
    raise exception 'FALLO: UPDATE GPS incompleto aceptado';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'ronda_puntos_gps_config_completa' then
      raise;
    end if;
  end;
  raise notice 'OK: UPDATE GPS incompleto rechazado';
end;
$$;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select auth_user_id::text from _ctx),
    'role', 'authenticated'
  )::text,
  true
);

create temp table _respuestas (
  paso text primary key,
  respuesta jsonb not null
) on commit drop;

insert into _respuestas
select '1_iniciada', public.iniciar_ronda((select id from _rondas where clave = 'a'));

create temp table _ejecucion on commit drop as
select (respuesta #>> '{ejecucion,id}')::uuid as id
from _respuestas
where paso = '1_iniciada';

create temp table _baseline on commit drop as
select
  to_jsonb(e) as ejecucion,
  (
    select jsonb_agg(to_jsonb(ep) order by ep.orden)
      from public.ronda_ejecucion_puntos ep
     where ep.ronda_ejecucion_id = e.id
  ) as puntos
from public.ronda_ejecuciones e
where e.id = (select id from _ejecucion);

insert into _respuestas
select '2_misma', public.iniciar_ronda((select id from _rondas where clave = 'a'));

insert into _respuestas
select '3_otra', public.iniciar_ronda((select id from _rondas where clave = 'b'));

do $$
declare
  v_iniciada jsonb;
  v_misma    jsonb;
  v_otra     jsonb;
begin
  select respuesta into v_iniciada from _respuestas where paso = '1_iniciada';
  select respuesta into v_misma    from _respuestas where paso = '2_misma';
  select respuesta into v_otra     from _respuestas where paso = '3_otra';

  if v_iniciada ->> 'contexto' <> 'iniciada' then
    raise exception 'FALLO: primera llamada no inició la ronda';
  end if;

  if v_misma ->> 'contexto' <> 'recuperada'
     or v_misma #>> '{ejecucion,id}' <> v_iniciada #>> '{ejecucion,id}' then
    raise exception 'FALLO: misma ronda no recuperó el mismo ID';
  end if;

  if v_otra ->> 'contexto' <> 'otra_ronda_en_curso' then
    raise exception 'FALLO: otra ronda no devolvió otra_ronda_en_curso';
  end if;

  if v_otra -> 'ejecucion'
     is distinct from public.rondas_ejecucion_json((select id from _ejecucion)) then
    raise exception 'FALLO: otra_ronda_en_curso no devolvió la ejecución contractual completa';
  end if;

  if v_otra #>> '{ejecucion,ronda_base_id}'
     <> (select id::text from _rondas where clave = 'a') then
    raise exception 'FALLO: otra_ronda_en_curso no identifica la ronda existente';
  end if;

  if (select count(*)
        from public.ronda_ejecuciones e
       where e.turno_id = (select turno_id from _ctx)
         and e.guardia_id = (select guardia_id from _ctx)
         and e.estado = 'en_curso') <> 1 then
    raise exception 'FALLO: se creó una ejecución adicional';
  end if;

  if exists (
    select 1
      from public.ronda_ejecuciones e
     where e.ronda_base_id = (select id from _rondas where clave = 'b')
  ) then
    raise exception 'FALLO: se creó una ejecución para la segunda ronda';
  end if;

  if (select to_jsonb(e)
        from public.ronda_ejecuciones e
       where e.id = (select id from _ejecucion))
     is distinct from (select ejecucion from _baseline) then
    raise exception 'FALLO: iniciar otra ronda mutó la ejecución existente';
  end if;

  if (select jsonb_agg(to_jsonb(ep) order by ep.orden)
        from public.ronda_ejecucion_puntos ep
       where ep.ronda_ejecucion_id = (select id from _ejecucion))
     is distinct from (select puntos from _baseline) then
    raise exception 'FALLO: iniciar otra ronda mutó los puntos existentes';
  end if;

  raise notice 'OK: C4 misma ronda, otra ronda, estructura completa y cero mutaciones';
end;
$$;

-- La restricción snapshot rechaza una actualización inválida.
do $$
declare
  v_constraint text;
begin
  begin
    update public.ronda_ejecucion_puntos
       set snap_gps_requerido = true,
           snap_latitud = null,
           snap_longitud = null,
           snap_radio_metros = null
     where ronda_ejecucion_id = (select id from _ejecucion)
       and orden = 1;
    raise exception 'FALLO: UPDATE snapshot GPS incompleto aceptado';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'ronda_ejecucion_puntos_snap_gps_config_completa' then
      raise;
    end if;
  end;
  raise notice 'OK: UPDATE snapshot GPS incompleto rechazado';
end;
$$;

-- Simula un snapshot legado inválido. El DROP y la alteración se revierten con
-- el ROLLBACK de esta transacción; no afectan el esquema ni datos permanentes.
alter table public.ronda_ejecucion_puntos
  drop constraint ronda_ejecucion_puntos_snap_gps_config_completa;

update public.ronda_ejecucion_puntos
   set snap_gps_requerido = true,
       snap_latitud = null,
       snap_longitud = null,
       snap_radio_metros = null
 where ronda_ejecucion_id = (select id from _ejecucion)
   and orden = 1;

create temp table _punto_invalido on commit drop as
select id, to_jsonb(ep) as antes
from public.ronda_ejecucion_puntos ep
where ep.ronda_ejecucion_id = (select id from _ejecucion)
  and ep.orden = 1;

create temp table _respuesta_config on commit drop as
select public.registrar_punto_ronda(
  (select id from _punto_invalido),
  -34.60,
  -58.40,
  5
) as respuesta;

do $$
begin
  if (select respuesta ->> 'contexto' from _respuesta_config)
     <> 'configuracion_gps_invalida' then
    raise exception 'FALLO: snapshot inválido no devolvió configuracion_gps_invalida';
  end if;

  if (select to_jsonb(ep)
        from public.ronda_ejecucion_puntos ep
       where ep.id = (select id from _punto_invalido))
     is distinct from (select antes from _punto_invalido) then
    raise exception 'FALLO: registrar_punto_ronda mutó el snapshot inválido';
  end if;

  raise notice 'OK: snapshot legado inválido devuelve contexto estable sin mutación';
end;
$$;

rollback;


-- ── 4. Casos aceptados y veredicto obligatorio ──────────────────────────────

begin;

create temp table _ctx on commit drop as
select
  u.auth_user_id,
  u.id as guardia_id,
  t.id as turno_id,
  t.objetivo_id,
  t.puesto_id
from public.turnos t
join public.usuarios u on u.id = t.guardia_id and u.estado = 'activo'
where u.auth_user_id is not null
  and t.puesto_id is not null
  and t.fecha in (
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1))
  and (t.fecha + t.hora_inicio) <= (now() at time zone 'America/Argentina/Buenos_Aires')
  and (now() at time zone 'America/Argentina/Buenos_Aires') < (
        t.fecha + t.hora_fin
        + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
  and not exists (
    select 1
      from public.ronda_ejecuciones e
     where e.turno_id = t.id
       and e.guardia_id = u.id
       and e.estado = 'en_curso')
limit 1;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception
      'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente y sin ejecución abierta';
  end if;
end;
$$;

create temp table _ronda on commit drop as
with creada as (
  insert into public.rondas_base (
    objetivo_id, puesto_id, nombre, intervalo_minutos, activo
  )
  select
    objetivo_id,
    puesto_id,
    'ZZZ verificación C1 aceptados ' || left(gen_random_uuid()::text, 8),
    60,
    true
  from _ctx
  returning id
)
select id from creada;

insert into public.ronda_puntos (
  ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
  latitud, longitud, radio_metros, activo
)
values
  ((select id from _ronda), 'GPS opcional', 1, false, false, null, null, null, true),
  ((select id from _ronda), 'GPS completo', 2, false, true, -34.60, -58.40, 100, true);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select auth_user_id::text from _ctx),
    'role', 'authenticated'
  )::text,
  true
);

create temp table _inicio on commit drop as
select public.iniciar_ronda((select id from _ronda)) as respuesta;

create temp table _puntos on commit drop as
select ep.id, ep.orden
from public.ronda_ejecucion_puntos ep
where ep.ronda_ejecucion_id = (
  select (respuesta #>> '{ejecucion,id}')::uuid from _inicio
);

create temp table _resultados (
  orden integer primary key,
  respuesta jsonb not null
) on commit drop;

insert into _resultados
values (
  1,
  public.registrar_punto_ronda(
    (select id from _puntos where orden = 1),
    null,
    null,
    null
  )
);

insert into _resultados
values (
  2,
  public.registrar_punto_ronda(
    (select id from _puntos where orden = 2),
    -34.60,
    -58.40,
    5
  )
);

do $$
declare
  v_opcional jsonb;
  v_requerido jsonb;
begin
  select respuesta into v_opcional from _resultados where orden = 1;
  select respuesta into v_requerido from _resultados where orden = 2;

  if v_opcional #>> '{punto,estado}' <> 'cumplido'
     or v_opcional #> '{punto,gps_ok}' is distinct from 'null'::jsonb
     or v_opcional #> '{punto,dentro_radio}' is distinct from 'null'::jsonb then
    raise exception 'FALLO: GPS no requerido sin coordenadas no fue aceptado';
  end if;

  if v_requerido #>> '{punto,estado}' <> 'cumplido'
     or v_requerido #>> '{punto,gps_ok}' <> 'true'
     or v_requerido #>> '{punto,dentro_radio}' <> 'true' then
    raise exception 'FALLO: GPS requerido completo y dentro del radio no quedó cumplido';
  end if;

  if v_requerido #>> '{ejecucion,estado}' <> 'finalizada'
     or v_requerido #>> '{ejecucion,resultado}' <> 'completa' then
    raise exception 'FALLO: cierre esperado de la ronda válida';
  end if;

  raise notice 'OK: configuraciones aceptadas y cumplimiento sólo con dentro_radio=true';
end;
$$;

rollback;


-- ── 5. Denegación real a anon ───────────────────────────────────────────────

begin;

do $$
begin
  begin
    set local role anon;
    perform public.iniciar_ronda(null);
    raise exception 'FALLO: anon pudo ejecutar iniciar_ronda';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado en iniciar_ronda (SQLSTATE 42501)';
  end;

  begin
    set local role anon;
    perform public.registrar_punto_ronda(null, null, null, null);
    raise exception 'FALLO: anon pudo ejecutar registrar_punto_ronda';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado en registrar_punto_ronda (SQLSTATE 42501)';
  end;
end;
$$;

rollback;

-- Fin. Ningún bloque funcional usa COMMIT.
