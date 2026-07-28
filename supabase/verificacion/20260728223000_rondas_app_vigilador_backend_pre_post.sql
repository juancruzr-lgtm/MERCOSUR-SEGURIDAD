-- ============================================================================
-- VERIFICACIÓN — Etapa 3.2, App Vigilador: soporte transaccional
-- ============================================================================
--
-- Acompaña a:
--   supabase/migrations/20260728223000_rondas_app_vigilador_backend.sql
--
-- Las pruebas funcionales terminan en ROLLBACK. No dejan rondas, ejecuciones ni
-- puntos de prueba. La carga HTTP de una foto se verifica por separado desde la
-- aplicación; este archivo valida que una fila sin objeto real no pueda fingir
-- una evidencia.
-- ============================================================================


-- ── 1. Antes de aplicar ──────────────────────────────────────────────────────

select
  to_regprocedure(
    'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)'
  ) is null as rpc_no_existe,
  to_regprocedure(
    'public.rondas_distancia_metros(double precision,double precision,double precision,double precision)'
  ) is null as distancia_no_existe,
  not exists (
    select 1 from storage.buckets where id = 'ronda-evidencias'
  ) as bucket_no_existe;

-- Esperado antes de aplicar: true · true · true.


-- ── 2. Después de aplicar: estructura y permisos ─────────────────────────────

select
  to_regprocedure(
    'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)'
  ) is not null as rpc_existe,
  to_regprocedure(
    'public.rondas_distancia_metros(double precision,double precision,double precision,double precision)'
  ) is not null as distancia_existe,
  exists (
    select 1
      from pg_trigger
     where tgname = 'trg_rondas_validar_evidencia_punto'
       and not tgisinternal
  ) as trigger_evidencia_existe,
  exists (
    select 1
      from storage.buckets
     where id = 'ronda-evidencias'
       and public = false
       and file_size_limit = 5242880
  ) as bucket_privado_ok;

select
  has_function_privilege(
    'anon',
    'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)',
    'EXECUTE'
  ) as anon_puede,
  has_function_privilege(
    'authenticated',
    'public.registrar_punto_ronda(uuid,double precision,double precision,double precision)',
    'EXECUTE'
  ) as authenticated_puede,
  has_function_privilege(
    'authenticated',
    'public.rondas_distancia_metros(double precision,double precision,double precision,double precision)',
    'EXECUTE'
  ) as cliente_puede_calcular_distancia;

-- Esperado: false · true · false.

select
  round(public.rondas_distancia_metros(-34.60, -58.40, -34.60, -58.40)) as metros_mismo_punto,
  round(public.rondas_distancia_metros(-34.60, -58.40, -34.61, -58.40)) as metros_un_grado_centesimal;

-- Esperado aproximado: 0 · 1112.


-- ── 3. Flujo funcional sin foto ─────────────────────────────────────────────
-- Requiere un vigilador con turno vigente, puesto asignado y ninguna ejecución
-- previa en curso en ese turno. Si no existe, el bloque informa la precondición.

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

create temp table _ctx on commit drop as
select
  u.auth_user_id,
  u.id as guardia_id,
  t.id as turno_id,
  t.objetivo_id,
  t.puesto_id
from turnos t
join usuarios u on u.id = t.guardia_id and u.estado = 'activo'
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
      from ronda_ejecuciones e
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
with nueva as (
  insert into rondas_base (
    objetivo_id, puesto_id, nombre, intervalo_minutos, activo
  )
  select
    objetivo_id,
    puesto_id,
    'ZZZ verificación 3.2 GPS ' || left(gen_random_uuid()::text, 8),
    60,
    true
  from _ctx
  returning id
)
select id from nueva;

insert into ronda_puntos (
  ronda_base_id, nombre, orden, foto_requerida, gps_requerido,
  latitud, longitud, radio_metros, activo
)
values
  ((select id from _ronda), 'Punto dentro', 1, false, true, -34.60, -58.40, 100, true),
  ((select id from _ronda), 'Punto fuera',  2, false, true, -34.60, -58.40, 10,  true);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select auth_user_id::text from _ctx),
    'role', 'authenticated'
  )::text,
  true
);

insert into _r
select '1_iniciar', iniciar_ronda((select id from _ronda));

create temp table _ejecucion on commit drop as
select (resultado #>> '{ejecucion,id}')::uuid as id
from _r where paso = '1_iniciar';

create temp table _puntos on commit drop as
select id, orden
from ronda_ejecucion_puntos
where ronda_ejecucion_id = (select id from _ejecucion)
order by orden;

-- No se puede saltear el primer punto.
insert into _r
select '2_fuera_de_secuencia',
  registrar_punto_ronda(
    (select id from _puntos where orden = 2),
    -34.60, -58.40, 5
  );

-- Una entrada GPS mal formada no muta el punto.
insert into _r
select '3_gps_invalido',
  registrar_punto_ronda(
    (select id from _puntos where orden = 1),
    -34.60, null, 5
  );

-- Mismas coordenadas: cumplido, distancia 0.
insert into _r
select '4_punto_dentro',
  registrar_punto_ronda(
    (select id from _puntos where orden = 1),
    -34.60, -58.40, 5
  );

-- Repetición: idempotente.
insert into _r
select '5_reintento',
  registrar_punto_ronda(
    (select id from _puntos where orden = 1),
    -34.60, -58.40, 5
  );

-- Aproximadamente 1,1 km con radio 10 m: incumplido y cierre incompleto.
insert into _r
select '6_punto_fuera_y_cierre',
  registrar_punto_ronda(
    (select id from _puntos where orden = 2),
    -34.61, -58.40, 8
  );

insert into _r
select '7_estado_persistido', jsonb_build_object(
  'punto_1', (select estado from ronda_ejecucion_puntos
               where id = (select id from _puntos where orden = 1)),
  'punto_2', (select estado from ronda_ejecucion_puntos
               where id = (select id from _puntos where orden = 2)),
  'ejecucion', (select estado from ronda_ejecuciones
                 where id = (select id from _ejecucion)),
  'resultado', (select resultado from ronda_ejecuciones
                 where id = (select id from _ejecucion)),
  'finalizada', (select finalizada_at is not null from ronda_ejecuciones
                  where id = (select id from _ejecucion))
);

select * from _r order by paso;

-- Esperado:
-- 2 contexto=fuera_de_secuencia
-- 3 contexto=gps_invalido
-- 4 contexto=registrado, punto.estado=cumplido
-- 5 contexto=ya_registrado
-- 6 contexto=registrado, punto.estado=incumplido,
--   ejecucion.estado=finalizada, resultado=incompleta
-- 7 cumplido · incumplido · finalizada · incompleta · true

rollback;


-- ── 4. Foto obligatoria e integridad de evidencia ────────────────────────────
-- Verifica que sin objeto real la ronda no avance y que tampoco sea posible
-- fabricar una fila de evidencia apuntando a un archivo inexistente.

begin;

create temp table _ctx on commit drop as
select
  u.auth_user_id,
  u.id as guardia_id,
  t.id as turno_id,
  t.objetivo_id,
  t.puesto_id
from turnos t
join usuarios u on u.id = t.guardia_id and u.estado = 'activo'
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
      from ronda_ejecuciones e
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
with nueva as (
  insert into rondas_base (
    objetivo_id, puesto_id, nombre, intervalo_minutos, activo
  )
  select
    objetivo_id,
    puesto_id,
    'ZZZ verificación 3.2 foto ' || left(gen_random_uuid()::text, 8),
    60,
    true
  from _ctx
  returning id
)
select id from nueva;

insert into ronda_puntos (
  ronda_base_id, nombre, orden, foto_requerida, gps_requerido, activo
)
values ((select id from _ronda), 'Punto con foto', 1, true, false, true);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select auth_user_id::text from _ctx),
    'role', 'authenticated'
  )::text,
  true
);

create temp table _inicio on commit drop as
select iniciar_ronda((select id from _ronda)) as respuesta;

create temp table _punto on commit drop as
select ep.id, ep.ronda_ejecucion_id
from ronda_ejecucion_puntos ep
where ep.ronda_ejecucion_id = (
  select (respuesta #>> '{ejecucion,id}')::uuid from _inicio
);

select registrar_punto_ronda((select id from _punto), null, null, null)
  as sin_foto;
-- Esperado: contexto=foto_pendiente y ejecución en_curso.

do $$
begin
  begin
    insert into evidencias (
      proceso_tipo, proceso_id, tipo_evidencia, bucket, storage_path
    )
    select
      'ronda',
      id,
      'punto_control',
      'ronda-evidencias',
      ronda_ejecucion_id::text || '/' || id::text || '/punto'
    from _punto;

    raise exception 'FALLO: se aceptó una evidencia sin objeto en Storage';
  exception
    when others then
      if sqlerrm = 'FALLO: se aceptó una evidencia sin objeto en Storage' then
        raise;
      end if;
      raise notice 'OK: evidencia falsa bloqueada: %', sqlerrm;
  end;
end;
$$;

select estado, registrado_at, foto_ok
from ronda_ejecucion_puntos
where id = (select id from _punto);
-- Esperado: pendiente · null · null.

rollback;


-- ── 5. Superficie anon ──────────────────────────────────────────────────────

begin;

do $$
begin
  begin
    set local role anon;
    perform registrar_punto_ronda(null, null, null, null);
    raise exception 'FALLO: anon pudo ejecutar registrar_punto_ronda';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado en registrar_punto_ronda (SQLSTATE 42501)';
  end;
end;
$$;

rollback;
