-- ============================================================================
-- VERIFICACIÓN — Política de foto por punto
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260729120000_ronda_puntos_politica_foto.sql
--
-- Secciones 1 y 2: solo lectura.
-- Sección 3: ejecuta las RPC dentro de transacciones que terminan en ROLLBACK.
-- No queda ningún dato de prueba.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Las columnas no deben existir. Esperado: 0.
select count(*) as columnas_nuevas
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'ronda_puntos'           and column_name = 'politica_foto') or
     (table_name = 'ronda_ejecucion_puntos' and column_name in ('snap_politica_foto', 'hay_novedad'))
   );

-- 1.2 Reparto actual de foto_requerida. Es lo que el backfill debe reproducir:
--     true -> obligatoria, false -> opcional.
select
  count(*) filter (where foto_requerida)      as seran_obligatoria,
  count(*) filter (where not foto_requerida)  as seran_opcional,
  count(*)                                    as total_puntos
from public.ronda_puntos;

-- 1.3 Snapshots existentes, mismo criterio.
select
  count(*) filter (where snap_foto_requerida)     as snap_seran_obligatoria,
  count(*) filter (where not snap_foto_requerida) as snap_seran_opcional
from public.ronda_ejecucion_puntos;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar (estructura, permisos y backfill)
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def text;
begin
  -- Columnas y constraints.
  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='ronda_puntos'
         and column_name='politica_foto' and is_nullable='NO') <> 1 then
    raise exception 'FALLO: falta politica_foto NOT NULL en ronda_puntos';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='ronda_ejecucion_puntos'
         and column_name in ('snap_politica_foto','hay_novedad')
         and is_nullable='NO') <> 2 then
    raise exception 'FALLO: faltan snap_politica_foto / hay_novedad NOT NULL';
  end if;

  for v_def in
    select pg_get_constraintdef(c.oid)
      from pg_constraint c
     where c.conname in ('ronda_puntos_politica_foto_valida',
                         'ronda_ejecucion_puntos_snap_politica_foto_valida')
  loop
    if v_def !~ 'obligatoria' or v_def !~ 'opcional' or v_def !~ 'solo_novedad' then
      raise exception 'FALLO: una constraint de política no contiene los tres valores';
    end if;
  end loop;

  if (select count(*) from pg_constraint
       where conname in ('ronda_puntos_politica_foto_valida',
                         'ronda_ejecucion_puntos_snap_politica_foto_valida')
         and contype='c' and convalidated) <> 2 then
    raise exception 'FALLO: faltan constraints de política o no están validadas';
  end if;

  -- Trigger de sincronización.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.ronda_puntos'::regclass
       and tgname  = 'trg_ronda_puntos_politica_foto'
       and not tgisinternal
  ) then
    raise exception 'FALLO: falta el trigger de sincronización de política';
  end if;

  -- Grants por columna: sin esto el editor no puede escribir la política.
  if not has_column_privilege('authenticated', 'public.ronda_puntos', 'politica_foto', 'INSERT')
     or not has_column_privilege('authenticated', 'public.ronda_puntos', 'politica_foto', 'UPDATE') then
    raise exception 'FALLO: authenticated no puede escribir politica_foto';
  end if;

  if has_column_privilege('anon', 'public.ronda_puntos', 'politica_foto', 'INSERT')
     or has_column_privilege('anon', 'public.ronda_puntos', 'politica_foto', 'UPDATE') then
    raise exception 'FALLO: anon puede escribir politica_foto';
  end if;

  raise notice 'OK: columnas, constraints, trigger y grants';
end;
$$;

do $$
begin
  -- La firma vieja de 4 parámetros no debe seguir existiendo: convivir con la
  -- nueva dejaría ambigua toda llamada de 1 a 4 argumentos.
  if to_regprocedure('public.registrar_punto_ronda(uuid,double precision,double precision,double precision)') is not null then
    raise exception 'FALLO: sobrevive la firma de 4 parámetros de registrar_punto_ronda';
  end if;

  if to_regprocedure('public.registrar_punto_ronda(uuid,double precision,double precision,double precision,boolean)') is null then
    raise exception 'FALLO: no existe la firma con p_hay_novedad';
  end if;

  if not has_function_privilege('authenticated',
       'public.registrar_punto_ronda(uuid,double precision,double precision,double precision,boolean)', 'EXECUTE') then
    raise exception 'FALLO: authenticated no puede ejecutar la nueva firma';
  end if;

  if has_function_privilege('anon',
       'public.registrar_punto_ronda(uuid,double precision,double precision,double precision,boolean)', 'EXECUTE') then
    raise exception 'FALLO: anon conserva EXECUTE sobre registrar_punto_ronda';
  end if;

  -- El contrato expone la política y la novedad.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='rondas_ejecucion_json'
       and p.prosrc like '%politica_foto%' and p.prosrc like '%hay_novedad%'
  ) then
    raise exception 'FALLO: rondas_ejecucion_json no expone politica_foto / hay_novedad';
  end if;

  -- iniciar_ronda copia la política al snapshot.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='iniciar_ronda'
       and p.prosrc like '%snap_politica_foto%'
  ) then
    raise exception 'FALLO: iniciar_ronda no copia politica_foto al snapshot';
  end if;

  -- El alta de puntos acepta la política: sin esto sólo podría fijarse editando.
  if to_regprocedure('public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean)') is not null then
    raise exception 'FALLO: sobrevive la firma de 11 parámetros de agregar_ronda_punto';
  end if;

  if to_regprocedure('public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean,text)') is null then
    raise exception 'FALLO: no existe agregar_ronda_punto con p_politica_foto';
  end if;

  if not has_function_privilege('authenticated',
       'public.agregar_ronda_punto(uuid,text,text,boolean,boolean,double precision,double precision,double precision,integer,text,boolean,text)', 'EXECUTE') then
    raise exception 'FALLO: authenticated no puede ejecutar la nueva firma de alta';
  end if;

  raise notice 'OK: firmas, permisos y contrato';
end;
$$;

-- 2.3 Backfill sin discrepancias. Esperado: 0 y 0.
select
  (select count(*) from public.ronda_puntos
    where politica_foto is distinct from
          (case when foto_requerida then 'obligatoria' else 'opcional' end)) as config_discrepante,
  (select count(*) from public.ronda_ejecucion_puntos
    where snap_politica_foto is distinct from
          (case when snap_foto_requerida then 'obligatoria' else 'opcional' end)) as snapshot_discrepante;

-- 2.4 Nada quedó en solo_novedad por el backfill: es un valor que sólo puede
--     aparecer por configuración explícita. Esperado: 0 y 0.
select
  (select count(*) from public.ronda_puntos where politica_foto = 'solo_novedad')            as config_solo_novedad,
  (select count(*) from public.ronda_ejecucion_puntos where snap_politica_foto = 'solo_novedad') as snap_solo_novedad;

-- 2.5 Lo que C3 y Supervisor usan no fue tocado. Esperado: todos 1.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rondas_turno_vigente')            as turno_vigente_intacta,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='obtener_ejecucion_actual')        as ejecucion_actual_intacta,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='reordenar_ronda_puntos')          as reordenar_intacta,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rondas_distancia_metros')         as haversine_intacta,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='puede_administrar_rondas_objetivo') as permiso_intacta;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — Pruebas funcionales (todo dentro de ROLLBACK)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3.1 El trigger sincroniza en los dos sentidos ───────────────────────────

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

create temp table _ronda on commit drop as
with base as (
  select o.id as objetivo_id, p.id as puesto_id
    from public.puestos p join public.objetivos o on o.id = p.objetivo_id
   limit 1
), creada as (
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id, 'ZZZ verif politica ' || left(gen_random_uuid()::text, 8), 60, true
    from base
  returning id
) select id from creada;

-- Escritor NUEVO: manda política, el trigger deriva el booleano.
insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, activo, politica_foto)
values ((select id from _ronda), 'Solo novedad', 1, false, true, 'solo_novedad');

-- Escritor PREVIO: manda sólo el booleano, el trigger deriva la política.
insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, activo, foto_requerida)
values ((select id from _ronda), 'Legado sin foto', 2, false, true, false);

insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, activo, foto_requerida)
values ((select id from _ronda), 'Legado con foto', 3, false, true, true);

insert into _r
select '1_insert', jsonb_agg(jsonb_build_object(
         'orden', orden, 'politica', politica_foto, 'booleano', foto_requerida) order by orden)
  from public.ronda_puntos where ronda_base_id = (select id from _ronda);
-- Esperado: 1 solo_novedad/false · 2 opcional/false · 3 obligatoria/true

-- UPDATE por política: manda la política.
update public.ronda_puntos set politica_foto = 'obligatoria'
 where ronda_base_id = (select id from _ronda) and orden = 1;

-- UPDATE por booleano legado: manda el booleano.
update public.ronda_puntos set foto_requerida = true
 where ronda_base_id = (select id from _ronda) and orden = 2;

insert into _r
select '2_update', jsonb_agg(jsonb_build_object(
         'orden', orden, 'politica', politica_foto, 'booleano', foto_requerida) order by orden)
  from public.ronda_puntos where ronda_base_id = (select id from _ronda);
-- Esperado: 1 obligatoria/true · 2 obligatoria/true · 3 obligatoria/true

-- Valor inválido rechazado.
do $$
begin
  begin
    update public.ronda_puntos set politica_foto = 'cuando_quiera'
     where ronda_base_id = (select id from _ronda) and orden = 3;
    insert into _r values ('3_valor_invalido', to_jsonb('FALLO: se aceptó un valor fuera del dominio'::text));
  exception when check_violation then
    insert into _r values ('3_valor_invalido', to_jsonb('OK: rechazado por constraint'::text));
  end;
end;
$$;

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 3.2 Las tres políticas en ejecución real ────────────────────────────────

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

create temp table _ctx on commit drop as
select u.auth_user_id, u.id as guardia_id, t.id as turno_id, t.objetivo_id, t.puesto_id
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
     select 1 from public.ronda_ejecuciones e
      where e.turno_id = t.id and e.guardia_id = u.id and e.estado = 'en_curso')
 limit 1;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception 'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente y sin ejecución abierta';
  end if;
end;
$$;

create temp table _ronda on commit drop as
with creada as (
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id, 'ZZZ verif politica ejec ' || left(gen_random_uuid()::text, 8), 60, true
    from _ctx
  returning id
) select id from creada;

-- Sin GPS para aislar la variable foto.
insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, activo, politica_foto)
values
  ((select id from _ronda), 'P1 opcional',     1, false, true, 'opcional'),
  ((select id from _ronda), 'P2 solo novedad', 2, false, true, 'solo_novedad'),
  ((select id from _ronda), 'P3 obligatoria',  3, false, true, 'obligatoria');

select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id::text from _ctx), 'role', 'authenticated')::text, true);

create temp table _ejec on commit drop as
select (public.iniciar_ronda((select id from _ronda)) #>> '{ejecucion,id}')::uuid as id;

insert into _r
select '1_snapshot', jsonb_agg(jsonb_build_object(
         'orden', ep.orden, 'snap_politica', ep.snap_politica_foto) order by ep.orden)
  from public.ronda_ejecucion_puntos ep where ep.ronda_ejecucion_id = (select id from _ejec);
-- Esperado: opcional · solo_novedad · obligatoria

-- P1 opcional, sin foto: se registra.
insert into _r
select '2_opcional_sin_foto', public.registrar_punto_ronda(
  (select id from public.ronda_ejecucion_puntos
    where ronda_ejecucion_id = (select id from _ejec) and orden = 1),
  null, null, null, false) -> 'punto';
-- Esperado: estado="cumplido"; foto_ok=null; hay_novedad=false.

-- P2 solo_novedad CON novedad y sin foto: bloquea.
insert into _r
select '3_novedad_sin_foto', to_jsonb(public.registrar_punto_ronda(
  (select id from public.ronda_ejecucion_puntos
    where ronda_ejecucion_id = (select id from _ejec) and orden = 2),
  null, null, null, true) ->> 'contexto');
-- Esperado: "foto_pendiente"

insert into _r
select '4_no_consumido', jsonb_build_object(
  'estado', (select estado from public.ronda_ejecucion_puntos
              where ronda_ejecucion_id = (select id from _ejec) and orden = 2));
-- Esperado: "pendiente". Un rechazo no consume el punto.

-- P2 solo_novedad SIN novedad y sin foto: se registra.
insert into _r
select '5_novedad_no_declarada', public.registrar_punto_ronda(
  (select id from public.ronda_ejecucion_puntos
    where ronda_ejecucion_id = (select id from _ejec) and orden = 2),
  null, null, null, false) -> 'punto';
-- Esperado: estado="cumplido"; foto_ok=null; hay_novedad=false.

-- P3 obligatoria sin foto: bloquea, como antes de este cambio.
insert into _r
select '6_obligatoria_sin_foto', to_jsonb(public.registrar_punto_ronda(
  (select id from public.ronda_ejecucion_puntos
    where ronda_ejecucion_id = (select id from _ejec) and orden = 3),
  null, null, null, false) ->> 'contexto');
-- Esperado: "foto_pendiente"

-- La ronda sigue abierta: el punto obligatorio no se pudo resolver.
insert into _r
select '7_ejecucion', jsonb_build_object(
  'estado',      (select estado from public.ronda_ejecuciones where id = (select id from _ejec)),
  'completados', (select count(*) from public.ronda_ejecucion_puntos
                   where ronda_ejecucion_id = (select id from _ejec) and estado <> 'pendiente'));
-- Esperado: en_curso y 2.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 3.3 El snapshot congela la política ─────────────────────────────────────
-- Editar el punto después de iniciar no puede cambiar las reglas de la ronda
-- en curso. Es la garantía que justifica la columna snap_politica_foto.

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

create temp table _ctx on commit drop as
select u.auth_user_id, t.objetivo_id, t.puesto_id
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
     select 1 from public.ronda_ejecuciones e
      where e.turno_id = t.id and e.guardia_id = u.id and e.estado = 'en_curso')
 limit 1;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception 'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente sin ejecución abierta';
  end if;
end;
$$;

create temp table _ronda on commit drop as
with creada as (
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id, 'ZZZ verif snapshot ' || left(gen_random_uuid()::text, 8), 60, true
    from _ctx
  returning id
) select id from creada;

insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, activo, politica_foto)
values ((select id from _ronda), 'P1 opcional', 1, false, true, 'opcional');

select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id::text from _ctx), 'role', 'authenticated')::text, true);

create temp table _ejec on commit drop as
select (public.iniciar_ronda((select id from _ronda)) #>> '{ejecucion,id}')::uuid as id;

-- El supervisor endurece la política DESPUÉS de iniciar.
update public.ronda_puntos set politica_foto = 'obligatoria'
 where ronda_base_id = (select id from _ronda);

insert into _r select '1_config_cambiada', jsonb_build_object(
  'config',   (select politica_foto from public.ronda_puntos where ronda_base_id = (select id from _ronda)),
  'snapshot', (select snap_politica_foto from public.ronda_ejecucion_puntos
                where ronda_ejecucion_id = (select id from _ejec)));
-- Esperado: config="obligatoria", snapshot="opcional".

-- La ejecución sigue las reglas viejas: se registra sin foto.
insert into _r
select '2_registro_con_regla_vieja', to_jsonb(public.registrar_punto_ronda(
  (select id from public.ronda_ejecucion_puntos where ronda_ejecucion_id = (select id from _ejec)),
  null, null, null, false) ->> 'contexto');
-- Esperado: "registrado". Si diera "foto_pendiente", el snapshot no serviría.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 3.4 anon sigue sin acceso ───────────────────────────────────────────────

begin;
  set local role anon;
  select public.registrar_punto_ronda(null, null, null, null, false);
rollback;

-- Fin. Ningún bloque funcional usa COMMIT.
