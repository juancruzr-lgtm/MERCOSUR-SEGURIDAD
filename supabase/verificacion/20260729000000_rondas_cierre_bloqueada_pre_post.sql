-- ============================================================================
-- VERIFICACIÓN — C3 mínimo: cierre administrativo de una ronda bloqueada
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260729000000_rondas_cierre_bloqueada.sql
--
-- Secciones 1 y 2: solo lectura.
-- Sección 3: ejecuta las RPC dentro de transacciones que terminan en ROLLBACK.
-- No queda ningún dato de prueba en la base.
--
-- Cada bloque acumula sus comprobaciones en una tabla temporal y las emite
-- juntas al final: el editor SQL de Supabase muestra sólo el último resultado.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Las columnas no deben existir todavía. Esperado: 0.
select count(*) as columnas_de_cierre
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'ronda_ejecuciones'
   and column_name in ('cerrada_por', 'cerrada_at', 'cerrada_motivo');

-- 1.2 Dependencias que la migración da por existentes. Esperado: todos true.
select
  (to_regclass('public.ronda_ejecuciones')      is not null) as tabla_ejecuciones_ok,
  (to_regclass('public.ronda_ejecucion_puntos') is not null) as tabla_puntos_ok,
  (to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is not null) as fn_permiso_ok,
  (to_regclass('public.ronda_ejecuciones_turno_guardia_en_curso_unique') is not null) as idx_en_curso_ok;

-- 1.3 Cuántas rondas están bloqueadas hoy, que es lo que motiva esta migración.
--     Una ejecución en curso cuya ventana de turno ya terminó está abandonada.
select
  count(*) as ejecuciones_en_curso,
  count(*) filter (
    where (now() at time zone 'America/Argentina/Buenos_Aires') >= (
      t.fecha + t.hora_fin
      + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
  ) as bloqueadas_con_turno_vencido
from public.ronda_ejecuciones e
join public.turnos t on t.id = e.turno_id
where e.estado = 'en_curso';


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar (estructura y permisos)
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def text;
begin
  -- Columnas.
  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='ronda_ejecuciones'
         and column_name in ('cerrada_por','cerrada_at','cerrada_motivo')) <> 3 then
    raise exception 'FALLO: faltan columnas de cierre administrativo';
  end if;

  -- FK de cerrada_por hacia usuarios, sin borrado en cascada.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ronda_ejecuciones'::regclass
       and contype  = 'f'
       and confrelid = 'public.usuarios'::regclass
       and pg_get_constraintdef(oid) ilike '%cerrada_por%'
       and pg_get_constraintdef(oid) ilike '%on delete restrict%'
  ) then
    raise exception 'FALLO: cerrada_por sin FK RESTRICT hacia usuarios';
  end if;

  -- Las tres constraints, validadas.
  if (select count(*) from pg_constraint
       where conrelid = 'public.ronda_ejecuciones'::regclass
         and contype = 'c' and convalidated
         and conname in ('ronda_ejecuciones_cierre_admin_completo',
                         'ronda_ejecuciones_cierre_admin_motivo_util',
                         'ronda_ejecuciones_cierre_admin_estado')) <> 3 then
    raise exception 'FALLO: faltan constraints de cierre administrativo o no están validadas';
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.ronda_ejecuciones'::regclass
     and conname  = 'ronda_ejecuciones_cierre_admin_motivo_util';
  if v_def !~ '10' then
    raise exception 'FALLO: el mínimo de 10 caracteres no está en la constraint de motivo';
  end if;

  -- Índice parcial de cierres administrativos.
  if not exists (
    select 1 from pg_indexes
     where schemaname='public'
       and indexname='idx_ronda_ejecuciones_cierre_admin'
       and indexdef ilike '%where (cerrada_por is not null)%'
  ) then
    raise exception 'FALLO: falta el índice parcial de cierres administrativos';
  end if;

  raise notice 'OK: columnas, FK, constraints e índice';
end;
$$;

do $$
begin
  -- anon no puede ejecutar ninguna de las dos.
  if has_function_privilege('anon', 'public.cerrar_ronda_bloqueada(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.listar_ejecuciones_en_curso_objetivo(uuid)', 'EXECUTE') then
    raise exception 'FALLO: anon conserva EXECUTE sobre las RPC de cierre';
  end if;

  if not has_function_privilege('authenticated', 'public.cerrar_ronda_bloqueada(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.listar_ejecuciones_en_curso_objetivo(uuid)', 'EXECUTE') then
    raise exception 'FALLO: authenticated no puede ejecutar las RPC de cierre';
  end if;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.cerrar_ronda_bloqueada(uuid,text)'::regprocedure
       and prosecdef
       and proconfig @> array['search_path=public, pg_catalog']
  ) then
    raise exception 'FALLO: cerrar_ronda_bloqueada sin SECURITY DEFINER o sin search_path';
  end if;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.listar_ejecuciones_en_curso_objetivo(uuid)'::regprocedure
       and prosecdef
       and proconfig @> array['search_path=public, pg_catalog']
  ) then
    raise exception 'FALLO: listar_ejecuciones_en_curso_objetivo sin SECURITY DEFINER o sin search_path';
  end if;

  raise notice 'OK: permisos, SECURITY DEFINER y search_path';
end;
$$;

-- 2.3 El contrato del vigilador NO fue modificado por esta migración.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rondas_ejecucion_json'
      and p.prosrc not like '%cerrada_por%')                        as json_sin_cerrada_por,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='iniciar_ronda'
      and p.prosrc like '%otra_ronda_en_curso%')                    as iniciar_ronda_intacta,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='registrar_punto_ronda'
      and p.prosrc like '%configuracion_gps_invalida%')             as registrar_punto_intacta;
-- Esperado: 1 · 1 · 1


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — Pruebas funcionales (todo dentro de ROLLBACK)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3.1 Cierre completo, conservación e idempotencia ────────────────────────

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

-- Vigilador con turno vigente y sin ejecución abierta.
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

-- Admin que ejecuta el cierre.
create temp table _admin on commit drop as
select u.auth_user_id, u.id
  from public.usuarios u
 where u.rol = 'admin' and u.estado = 'activo' and u.auth_user_id is not null
 limit 1;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception 'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente y sin ejecución abierta';
  end if;
  if not exists (select 1 from _admin) then
    raise exception 'VERIFICACIÓN OMITIDA: falta un usuario admin activo con auth_user_id';
  end if;
end;
$$;

-- Ronda de prueba con tres puntos sin exigencias, para poder registrar sin
-- foto ni GPS y dejar puntos resueltos que el cierre debe conservar.
create temp table _ronda on commit drop as
with creada as (
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id,
         'ZZZ verificacion C3 ' || left(gen_random_uuid()::text, 8), 60, true
    from _ctx
  returning id
) select id from creada;

insert into public.ronda_puntos
  (ronda_base_id, nombre, orden, foto_requerida, gps_requerido, latitud, longitud, radio_metros, activo)
values
  ((select id from _ronda), 'Punto 1', 1, false, false, null, null, null, true),
  ((select id from _ronda), 'Punto 2', 2, false, false, null, null, null, true),
  ((select id from _ronda), 'Punto 3', 3, false, false, null, null, null, true);

-- El vigilador inicia y resuelve sólo el primer punto: quedan dos pendientes.
select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id::text from _ctx), 'role', 'authenticated')::text, true);

create temp table _ejec on commit drop as
select (public.iniciar_ronda((select id from _ronda)) #>> '{ejecucion,id}')::uuid as id;

select public.registrar_punto_ronda(
  (select ep.id from public.ronda_ejecucion_puntos ep
    where ep.ronda_ejecucion_id = (select id from _ejec) and ep.orden = 1),
  null, null, null);

-- Foto del punto ya resuelto, para comprobar después que el cierre no lo tocó.
create temp table _antes on commit drop as
select to_jsonb(ep) as fila
  from public.ronda_ejecucion_puntos ep
 where ep.ronda_ejecucion_id = (select id from _ejec) and ep.orden = 1;

-- Ahora actúa el admin.
select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id::text from _admin), 'role', 'authenticated')::text, true);

-- Motivo demasiado corto: rechazado sin escribir.
insert into _r select '1_motivo_corto',
  to_jsonb(public.cerrar_ronda_bloqueada((select id from _ejec), 'corto') ->> 'contexto');
-- Esperado: "motivo_invalido"

insert into _r select '2_sin_efecto_tras_rechazo', jsonb_build_object(
  'estado',    (select estado from public.ronda_ejecuciones where id = (select id from _ejec)),
  'pendientes',(select count(*) from public.ronda_ejecucion_puntos
                 where ronda_ejecucion_id = (select id from _ejec) and estado = 'pendiente'));
-- Esperado: en_curso y 2.

-- Cierre válido.
insert into _r select '3_cierre',
  public.cerrar_ronda_bloqueada((select id from _ejec), 'Porton del sector B sin llave, punto inaccesible');
-- Esperado: contexto="cerrada"; puntos_omitidos=2; puntos_conservados=1.

insert into _r select '4_ejecucion_resultante', (
  select jsonb_build_object(
    'estado',            e.estado,
    'resultado',         e.resultado,
    'finalizada_at_ok',  e.finalizada_at is not null,
    'cerrada_por_ok',    e.cerrada_por = (select id from _admin),
    'cerrada_at_ok',     e.cerrada_at is not null,
    'motivo',            e.cerrada_motivo)
  from public.ronda_ejecuciones e where e.id = (select id from _ejec));
-- Esperado: finalizada · incompleta · true · true · true · el motivo completo.

insert into _r select '5_puntos', (
  select jsonb_build_object(
    'omitidos',            count(*) filter (where ep.estado = 'omitido'),
    'omitidos_con_sello',  count(*) filter (where ep.estado = 'omitido' and ep.registrado_at is not null),
    'omitidos_sin_veredicto', count(*) filter (where ep.estado = 'omitido'
                                and ep.gps_ok is null and ep.dentro_radio is null
                                and ep.foto_ok is null and ep.distancia_metros is null),
    'pendientes',          count(*) filter (where ep.estado = 'pendiente'),
    'cumplidos',           count(*) filter (where ep.estado = 'cumplido'))
  from public.ronda_ejecucion_puntos ep
 where ep.ronda_ejecucion_id = (select id from _ejec));
-- Esperado: 2 · 2 · 2 · 0 · 1.

insert into _r select '6_punto_resuelto_intacto', jsonb_build_object(
  'sin_cambios', (select to_jsonb(ep) from public.ronda_ejecucion_puntos ep
                   where ep.ronda_ejecucion_id = (select id from _ejec) and ep.orden = 1)
                 is not distinct from (select fila from _antes));
-- Esperado: true. El cierre no tocó el punto ya registrado.

insert into _r select '7_indice_liberado', jsonb_build_object(
  'ejecuciones_en_curso_del_guardia', (
    select count(*) from public.ronda_ejecuciones e
     where e.turno_id = (select turno_id from _ctx)
       and e.guardia_id = (select guardia_id from _ctx)
       and e.estado = 'en_curso'));
-- Esperado: 0. El vigilador ya puede iniciar otra ronda del puesto.

-- Idempotencia: segundo intento no pisa nada.
create temp table _cierre_previo on commit drop as
select to_jsonb(e) as fila from public.ronda_ejecuciones e where e.id = (select id from _ejec);

insert into _r select '8_idempotencia',
  to_jsonb(public.cerrar_ronda_bloqueada((select id from _ejec), 'Otro motivo distinto del original') ->> 'contexto');
-- Esperado: "ya_cerrada"

insert into _r select '9_sin_mutacion_tras_reintento', jsonb_build_object(
  'sin_cambios', (select to_jsonb(e) from public.ronda_ejecuciones e where e.id = (select id from _ejec))
                 is not distinct from (select fila from _cierre_previo));
-- Esperado: true. Ni autor, ni hora, ni motivo cambiaron.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 3.2 Autorización ────────────────────────────────────────────────────────

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
    raise exception 'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente sin ejecución abierta';
  end if;
end;
$$;

create temp table _ronda on commit drop as
with creada as (
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id,
         'ZZZ verificacion C3 permisos ' || left(gen_random_uuid()::text, 8), 60, true
    from _ctx
  returning id
) select id from creada;

insert into public.ronda_puntos
  (ronda_base_id, nombre, orden, foto_requerida, gps_requerido, latitud, longitud, radio_metros, activo)
values ((select id from _ronda), 'Punto unico', 1, false, false, null, null, null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id::text from _ctx), 'role', 'authenticated')::text, true);

create temp table _ejec on commit drop as
select (public.iniciar_ronda((select id from _ronda)) #>> '{ejecucion,id}')::uuid as id;

-- El propio vigilador NO puede cerrar su ronda.
insert into _r select '1_vigilador_no_puede',
  to_jsonb(public.cerrar_ronda_bloqueada((select id from _ejec), 'Intento de cierre por el propio vigilador') ->> 'contexto');
-- Esperado: "sin_permiso"

-- Tampoco puede listar las ejecuciones del objetivo.
insert into _r select '2_vigilador_no_lista',
  to_jsonb(public.listar_ejecuciones_en_curso_objetivo((select objetivo_id from _ctx)) ->> 'contexto');
-- Esperado: "sin_permiso"

insert into _r select '3_sin_efecto', jsonb_build_object(
  'estado', (select estado from public.ronda_ejecuciones where id = (select id from _ejec)));
-- Esperado: en_curso. Un rechazo no deja rastro.

-- Un admin sí puede listar, y ve la ejecución.
select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select auth_user_id::text from public.usuarios
             where rol='admin' and estado='activo' and auth_user_id is not null limit 1),
    'role','authenticated')::text, true);

insert into _r select '4_admin_lista', (
  select jsonb_build_object(
    'contexto', r ->> 'contexto',
    'encuentra_la_ejecucion', exists (
      select 1 from jsonb_array_elements(r -> 'ejecuciones') x
       where (x ->> 'id')::uuid = (select id from _ejec)))
  from public.listar_ejecuciones_en_curso_objetivo((select objetivo_id from _ctx)) r);
-- Esperado: "ok" y true.

-- Ejecución inexistente.
insert into _r select '5_inexistente',
  to_jsonb(public.cerrar_ronda_bloqueada(gen_random_uuid(), 'Motivo suficientemente largo para pasar') ->> 'contexto');
-- Esperado: "ejecucion_no_encontrada"

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 3.3 Una ronda terminada normalmente no se puede cerrar a mano ───────────

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
    raise exception 'VERIFICACIÓN OMITIDA: falta un vigilador con turno vigente sin ejecución abierta';
  end if;
end;
$$;

create temp table _ronda on commit drop as
with creada as (
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id,
         'ZZZ verificacion C3 completa ' || left(gen_random_uuid()::text, 8), 60, true
    from _ctx
  returning id
) select id from creada;

insert into public.ronda_puntos
  (ronda_base_id, nombre, orden, foto_requerida, gps_requerido, latitud, longitud, radio_metros, activo)
values ((select id from _ronda), 'Punto unico', 1, false, false, null, null, null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id::text from _ctx), 'role', 'authenticated')::text, true);

create temp table _ejec on commit drop as
select (public.iniciar_ronda((select id from _ronda)) #>> '{ejecucion,id}')::uuid as id;

-- El vigilador la termina por sus propios medios.
select public.registrar_punto_ronda(
  (select ep.id from public.ronda_ejecucion_puntos ep
    where ep.ronda_ejecucion_id = (select id from _ejec) and ep.orden = 1),
  null, null, null);

insert into _r select '1_cerrada_por_el_vigilador', (
  select jsonb_build_object('estado', e.estado, 'resultado', e.resultado,
                            'cerrada_por_null', e.cerrada_por is null)
    from public.ronda_ejecuciones e where e.id = (select id from _ejec));
-- Esperado: finalizada · completa · true.
-- `cerrada_por is null` es lo que distingue este caso del cierre administrativo.

select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select auth_user_id::text from public.usuarios
             where rol='admin' and estado='activo' and auth_user_id is not null limit 1),
    'role','authenticated')::text, true);

insert into _r select '2_no_se_puede_recerrar',
  to_jsonb(public.cerrar_ronda_bloqueada((select id from _ejec), 'Intento de reescribir un resultado legitimo') ->> 'contexto');
-- Esperado: "ejecucion_no_bloqueada"

insert into _r select '3_resultado_intacto', (
  select jsonb_build_object('estado', e.estado, 'resultado', e.resultado,
                            'cerrada_por_null', e.cerrada_por is null)
    from public.ronda_ejecuciones e where e.id = (select id from _ejec));
-- Esperado: idéntico al paso 1.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 3.4 Denegación a anon ───────────────────────────────────────────────────
-- Cada sentencia debe fallar con "permission denied". El error aborta la
-- transacción, por eso van de a una.

begin;
  set local role anon;
  select public.cerrar_ronda_bloqueada(null, 'Motivo suficientemente largo');
rollback;

begin;
  set local role anon;
  select public.listar_ejecuciones_en_curso_objetivo(null);
rollback;


-- ── 3.5 Las constraints resisten un UPDATE directo ──────────────────────────
-- Defensa en profundidad: aunque alguien tenga acceso a la tabla, no puede
-- fabricar un cierre a medias.

begin;

create temp table _r (paso text primary key, resultado text) on commit drop;

do $$
declare
  v_id uuid;
  v_sql text;
begin
  select id into v_id from public.ronda_ejecuciones limit 1;
  if v_id is null then
    insert into _r values ('0_sin_datos', 'No hay ejecuciones: sección omitida');
    return;
  end if;

  -- Cierre incompleto: autor sin motivo ni hora.
  begin
    update public.ronda_ejecuciones set cerrada_por = guardia_id where id = v_id;
    insert into _r values ('1_cierre_a_medias', 'FALLO: se aceptó un cierre sin motivo ni hora');
  exception when check_violation then
    insert into _r values ('1_cierre_a_medias', 'OK: rechazado por constraint');
  end;

  -- Motivo demasiado corto.
  begin
    update public.ronda_ejecuciones
       set cerrada_por = guardia_id, cerrada_at = now(), cerrada_motivo = 'corto'
     where id = v_id;
    insert into _r values ('2_motivo_corto', 'FALLO: se aceptó un motivo de menos de 10 caracteres');
  exception when check_violation then
    insert into _r values ('2_motivo_corto', 'OK: rechazado por constraint');
  end;

  -- Cierre administrativo sobre una ejecución que no está finalizada.
  begin
    update public.ronda_ejecuciones
       set estado = 'en_curso', resultado = null, finalizada_at = null,
           cerrada_por = guardia_id, cerrada_at = now(),
           cerrada_motivo = 'Motivo suficientemente largo'
     where id = v_id;
    insert into _r values ('3_cierre_sobre_en_curso', 'FALLO: se aceptó cierre sobre una ejecución en curso');
  exception when check_violation then
    insert into _r values ('3_cierre_sobre_en_curso', 'OK: rechazado por constraint');
  end;
end;
$$;

select * from _r order by paso;   -- <<< copiar este resultado

rollback;

-- Fin. Ningún bloque funcional usa COMMIT.


/*
================================================================================
Consulta de referencia para reportes
================================================================================
Toda métrica de cumplimiento debe separar el cierre administrativo del
resultado del vigilador. Sin este filtro, una ronda cerrada por el supervisor
se le imputa al guardia como ronda incompleta.

select
  count(*) filter (where resultado = 'completa')                          as completas,
  count(*) filter (where resultado = 'incompleta' and cerrada_por is null) as incompletas_del_vigilador,
  count(*) filter (where cerrada_por is not null)                          as cerradas_por_supervision
from public.ronda_ejecuciones
where fecha_operativa between :desde and :hasta;
================================================================================
*/
