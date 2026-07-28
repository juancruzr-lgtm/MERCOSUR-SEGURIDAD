-- ============================================================================
-- VERIFICACIÓN — Etapa 3, Fase 1: base transaccional de ejecución de rondas
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260728200000_rondas_ejecucion_base.sql
--
-- Las secciones 1 y 2 son de solo lectura.
-- La sección 3 ejecuta las RPC dentro de transacciones que terminan en
-- ROLLBACK: no persiste ninguna ejecución de prueba.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Las tablas no deben existir todavía. Esperado: 0 y 0.
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ronda_ejecuciones')      as tabla_ejecuciones,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ronda_ejecucion_puntos') as tabla_puntos;

-- 1.2 Dependencias que la migración da por existentes. Esperado: todos true.
select
  (select p.prorettype = 'trigger'::regtype
     from pg_proc p
    where p.oid = to_regprocedure('public.set_updated_at()'))
    as fn_set_updated_at_ok,
  (select p.prorettype = 'boolean'::regtype
     from pg_proc p
    where p.oid = to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)'))
    as fn_permiso_rondas_ok,
  (select
       i.indrelid = 'public.puestos'::regclass
       and i.indisunique
       and i.indisvalid
       and i.indimmediate
       and i.indpred is null
       and i.indexprs is null
       and i.indnkeyatts = 2
       and (
         select array_agg(a.attname::text order by k.ordinality)
           from unnest(i.indkey) with ordinality as k(attnum, ordinality)
           join pg_attribute a
             on a.attrelid = i.indrelid
            and a.attnum = k.attnum
          where k.ordinality <= i.indnkeyatts
       ) = array['id', 'objetivo_id']
     from pg_index i
    where i.indexrelid = to_regclass('public.puestos_id_objetivo_unique'))
    as idx_puestos_compuesto_ok,
  (select p.prorettype = 'jsonb'::regtype
     from pg_proc p
    where p.oid = to_regprocedure('public.obtener_rondas_guardia_actual()'))
    as rpc_etapa2_ok;

-- 1.3 Material disponible para probar: rondas activas con puntos activos.
select rb.id as ronda_base_id, rb.nombre, o.nombre as objetivo, p.nombre as puesto,
       count(rp.id) filter (where rp.activo) as puntos_activos
  from rondas_base rb
  join objetivos o on o.id = rb.objetivo_id
  join puestos   p on p.id = rb.puesto_id
  left join ronda_puntos rp on rp.ronda_base_id = rb.id
 where rb.activo
 group by rb.id, rb.nombre, o.nombre, p.nombre
 order by puntos_activos desc, rb.nombre;

-- Una ronda con 0 puntos activos debe hacer que iniciar_ronda devuelva
-- 'ronda_sin_puntos'. Sirve para la prueba 3.4.


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Estructura creada. Esperado: 1 · 1 · 4 · 2 (tablas con RLS habilitada).
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ronda_ejecuciones')      as tabla_ejecuciones,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ronda_ejecucion_puntos') as tabla_puntos,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('iniciar_ronda','obtener_ejecucion_actual',
                        'rondas_turno_vigente','rondas_ejecucion_json'))  as funciones,
  (select count(*) from pg_class
    where relname in ('ronda_ejecuciones','ronda_ejecucion_puntos')
      and relnamespace='public'::regnamespace and relrowsecurity)         as tablas_con_rls;

-- 2.2 El índice que sostiene la invariante de concurrencia.
--     Debe ser UNIQUE sobre (turno_id, guardia_id) con WHERE estado='en_curso'.
select indexname, indexdef
  from pg_indexes
 where schemaname='public'
   and indexname='ronda_ejecuciones_turno_guardia_en_curso_unique';

-- 2.3 Seguridad de las funciones. Esperado para las cuatro:
--     DEFINER · search_path fijado · anon=false · authenticated según columna.
select p.proname,
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end as seguridad,
       p.proconfig                                             as search_path,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('iniciar_ronda','obtener_ejecucion_actual',
                     'rondas_turno_vigente','rondas_ejecucion_json')
 order by p.proname;

-- anon debe ser false en las cuatro.
-- authenticated: true en iniciar_ronda, obtener_ejecucion_actual y
-- rondas_turno_vigente; false en rondas_ejecucion_json, que es interna.

-- 2.4 RLS: sólo lectura para admin/supervisor, ninguna política de escritura,
--     ninguna para el vigilador. Esperado: 2 filas, ambas cmd=SELECT.
select tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname='public'
   and tablename in ('ronda_ejecuciones','ronda_ejecucion_puntos')
 order by tablename;

-- 2.5 Grants. Esperado: anon sin nada; authenticated sólo SELECT.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
  from information_schema.role_table_grants
 where table_schema='public'
   and table_name in ('ronda_ejecuciones','ronda_ejecucion_puntos')
   and grantee in ('anon','authenticated')
 group by table_name, grantee
 order by table_name, grantee;

-- 2.6 La RPC de la Etapa 2 no fue modificada: sigue devolviendo el placeholder.
select count(*) as sigue_con_placeholder
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname='obtener_rondas_guardia_actual'
   and p.prosrc like '%''ejecucion_actual'',  null%';
-- Esperado: 1


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — Material real para las pruebas (SOLO LECTURA, antes de aplicar)
-- ════════════════════════════════════════════════════════════════════════════
-- Ningún UUID se escribe a mano: las pruebas de la sección 4 resuelven por
-- consulta el guardia, el turno y las rondas que necesitan. Esta sección sólo
-- sirve para saber DE ANTEMANO si hoy hay material suficiente.

-- 3.1 Vigiladores con turno vigente ahora mismo, y si su puesto tiene rondas
--     utilizables (activas y con al menos un punto activo).
select
  u.apellido || ', ' || u.nombre         as guardia,
  (u.auth_user_id is not null)           as tiene_auth,
  t.fecha, t.hora_inicio, t.hora_fin,
  o.nombre                               as objetivo,
  p.nombre                               as puesto,
  (select count(*) from rondas_base rb
    where rb.puesto_id = t.puesto_id and rb.activo
      and exists (select 1 from ronda_puntos rp
                   where rp.ronda_base_id = rb.id and rp.activo)) as rondas_utilizables
from turnos t
join usuarios  u on u.id = t.guardia_id and u.estado = 'activo'
join objetivos o on o.id = t.objetivo_id
join puestos   p on p.id = t.puesto_id
where t.fecha in (
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
        ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1))
  and (t.fecha + t.hora_inicio) <= (now() at time zone 'America/Argentina/Buenos_Aires')
  and (now() at time zone 'America/Argentina/Buenos_Aires') < (
        t.fecha + t.hora_fin
        + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
order by rondas_utilizables desc, t.fecha desc;

-- Lectura del resultado:
--   * Al menos una fila con tiene_auth = true y rondas_utilizables >= 1
--     -> las pruebas 4.1 y 4.2 corren completas.
--   * Ninguna fila así -> 4.1 y 4.2 se omiten con un error explícito de falta de
--     material. No es un fallo de la migración: la Fase 1 se valida igual con la
--     sección 2 y con 4.3, que no dependen de un turno en curso.


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 4 — Pruebas funcionales, DESPUÉS de aplicar
-- ════════════════════════════════════════════════════════════════════════════
--
-- CÓMO CORRERLAS
--   Un bloque `begin; ... rollback;` por vez. Cada bloque termina en ROLLBACK:
--   no queda ninguna ejecución de prueba en la base. El último `select` de cada
--   bloque es el resultado a copiar — el editor SQL de Supabase muestra sólo el
--   resultado de la última sentencia, por eso cada bloque acumula sus
--   comprobaciones en una tabla temporal y las emite juntas al final.
--
-- POR QUÉ NO SE CAMBIA DE ROL EN LOS BLOQUES 4.1 Y 4.2
--   La identidad que importa es la de `auth.uid()`, que sale de
--   `request.jwt.claims`, no del rol de Postgres. Las RPC son SECURITY DEFINER:
--   se comportan igual con cualquier rol. Ejecutar como `postgres` permite
--   además inspeccionar las tablas para comprobar lo que la RPC escribió. El
--   control de acceso real —que el vigilador no pueda leer las tablas por su
--   cuenta— se prueba aparte, en 4.1 paso 6 y en 4.4.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 4.1 Camino feliz completo ───────────────────────────────────────────────
-- Cubre: iniciar una ejecución válida · sólo puntos activos precreados ·
-- fidelidad del snapshot · idempotencia de la segunda llamada · aislamiento
-- del vigilador respecto de las tablas.

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

-- Guardia de prueba: el primero con turno vigente y rondas utilizables.
create temp table _ctx on commit drop as
select u.auth_user_id, u.id as guardia_id, t.id as turno_id, t.puesto_id
  from turnos t
  join usuarios u on u.id = t.guardia_id and u.estado = 'activo'
 where u.auth_user_id is not null
   and t.fecha in (
         ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
         ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1))
   and (t.fecha + t.hora_inicio) <= (now() at time zone 'America/Argentina/Buenos_Aires')
   and (now() at time zone 'America/Argentina/Buenos_Aires') < (
         t.fecha + t.hora_fin
         + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
   and exists (select 1 from rondas_base rb
                where rb.puesto_id = t.puesto_id and rb.activo
                  and exists (select 1 from ronda_puntos rp
                               where rp.ronda_base_id = rb.id and rp.activo))
 limit 1;

insert into _r
select '0_hay_material', jsonb_build_object('guardias_candidatos', count(*)) from _ctx;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception
      'VERIFICACION OMITIDA: no hay un usuario con turno vigente y una ronda utilizable para 4.1';
  end if;
end;
$$;

select set_config('request.jwt.claims',
         json_build_object('sub', (select auth_user_id::text from _ctx),
                           'role', 'authenticated')::text,
         true);

-- Paso 1: antes de iniciar no hay ejecución.
insert into _r
select '1_antes_de_iniciar', to_jsonb(obtener_ejecucion_actual() ->> 'contexto');
-- Esperado: "sin_ejecucion"

-- Paso 2: iniciar. La ronda se resuelve sola, por el puesto del turno vigente.
insert into _r
select '2_iniciar', iniciar_ronda((
         select rb.id from rondas_base rb
          where rb.puesto_id = (select puesto_id from _ctx)
            and rb.activo
            and exists (select 1 from ronda_puntos rp
                         where rp.ronda_base_id = rb.id and rp.activo)
          order by rb.nombre limit 1));
-- Esperado en el JSON: contexto="iniciada"; ejecucion.estado="en_curso";
-- porcentaje=0; puntos_completados=0; puede_continuar=true; resultado=null;
-- punto_actual_id = el punto de orden 1; puntos_total = cantidad de puntos
-- activos; y la clave `puntos` con las 11 propiedades de RondaEjecucionPuntoEstado.

create temp table _ejecucion_prueba on commit drop as
select (resultado #>> '{ejecucion,id}')::uuid as id
  from _r
 where paso = '2_iniciar';

-- Paso 3: sólo se copiaron los puntos ACTIVOS.
insert into _r
select '3_puntos_precreados', jsonb_build_object(
  'filas_creadas',           (select count(*) from ronda_ejecucion_puntos
                               where ronda_ejecucion_id = (select id from _ejecucion_prueba)),
  'todas_pendientes',        (select count(*) from ronda_ejecucion_puntos
                               where ronda_ejecucion_id = (select id from _ejecucion_prueba)
                                 and estado = 'pendiente'),
  'puntos_total_registrado', (select puntos_total from ronda_ejecuciones
                               where id = (select id from _ejecucion_prueba)),
  'puntos_activos_config',   (select count(*) from ronda_puntos rp
                               join ronda_ejecuciones e on e.ronda_base_id = rp.ronda_base_id
                              where e.id = (select id from _ejecucion_prueba)
                                and rp.activo),
  'inactivos_copiados',      (select count(*) from ronda_ejecucion_puntos ep
                               join ronda_puntos rp on rp.id = ep.ronda_punto_id
                              where ep.ronda_ejecucion_id = (select id from _ejecucion_prueba)
                                and not rp.activo));
-- Esperado: los cuatro primeros iguales entre sí; inactivos_copiados = 0.

-- Paso 4: el snapshot refleja exactamente la configuración vigente al iniciar.
insert into _r
select '4_snapshot_fiel', jsonb_build_object(
  'puntos',            count(*),
  'discrepancias',     count(*) filter (where not (
                          ep.snap_nombre = rp.nombre
                      and ep.snap_latitud      is not distinct from rp.latitud
                      and ep.snap_longitud     is not distinct from rp.longitud
                      and ep.snap_radio_metros is not distinct from rp.radio_metros
                      and ep.snap_foto_requerida = rp.foto_requerida
                      and ep.snap_gps_requerido  = rp.gps_requerido)),
  'orden_correlativo', (min(ep.orden) = 1 and max(ep.orden) = count(*)))
from ronda_ejecucion_puntos ep
join ronda_puntos rp on rp.id = ep.ronda_punto_id
where ep.ronda_ejecucion_id = (select id from _ejecucion_prueba);
-- Esperado: discrepancias = 0; orden_correlativo = true.

-- Paso 5: la segunda llamada devuelve la misma ejecución, no crea otra.
insert into _r
select '5_idempotencia', jsonb_build_object(
  'contexto', iniciar_ronda((
                 select e.ronda_base_id
                   from ronda_ejecuciones e
                  where e.id = (select id from _ejecucion_prueba))) ->> 'contexto',
  'ejecuciones_en_curso_del_turno',
    (select count(*)
       from ronda_ejecuciones e
      where e.turno_id = (select turno_id from _ctx)
        and e.guardia_id = (select guardia_id from _ctx)
        and e.estado = 'en_curso'));
-- Esperado: contexto = "recuperada"; ejecuciones_en_curso_del_turno = 1.

-- Paso 6: con una ejecución existente, el vigilador no la ve por SELECT directo.
--         Se consulta con el rol `authenticated` y sus propias claims.
set local role authenticated;
create temp table _rls on commit drop as
select (select count(*) from ronda_ejecuciones)      as ejecuciones_visibles,
       (select count(*) from ronda_ejecucion_puntos) as puntos_visibles;
reset role;

insert into _r select '6_rls_vigilador', to_jsonb(r) from _rls r;
-- Esperado: ambos 0, mientras que el paso 5 vio 1. El acceso del vigilador es
-- exclusivamente por RPC.
-- Si esta sentencia falla con "permission denied to create temporary tables",
-- no es un defecto de la migración: correr entonces el bloque 4.4, que prueba
-- lo mismo sin tabla temporal.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 4.2 Rechazos ────────────────────────────────────────────────────────────
-- Cubre: ronda de otro puesto · ronda sin puntos activos.
-- La ronda sin puntos se crea dentro de la transacción, porque en producción
-- puede no existir ninguna en el puesto del guardia. El ROLLBACK la elimina.

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

create temp table _ctx on commit drop as
select u.auth_user_id, t.id as turno_id, t.objetivo_id, t.puesto_id,
       otra_ronda.id as ronda_otro_puesto_id
  from turnos t
  join usuarios u on u.id = t.guardia_id and u.estado = 'activo'
  cross join lateral (
    select rb.id
      from rondas_base rb
     where rb.activo
       and rb.puesto_id is distinct from t.puesto_id
     order by rb.id
     limit 1
  ) otra_ronda
 where u.auth_user_id is not null
   and t.fecha in (
         ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
         ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1))
   and (t.fecha + t.hora_inicio) <= (now() at time zone 'America/Argentina/Buenos_Aires')
   and (now() at time zone 'America/Argentina/Buenos_Aires') < (
         t.fecha + t.hora_fin
         + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
 limit 1;

insert into _r
select '0_hay_material', jsonb_build_object('guardias_candidatos', count(*)) from _ctx;

do $$
begin
  if not exists (select 1 from _ctx) then
    raise exception
      'VERIFICACION OMITIDA: no hay un usuario con turno vigente y una ronda activa de otro puesto para 4.2';
  end if;
end;
$$;

create temp table _antes on commit drop as
select
  (select count(*) from ronda_ejecuciones)       as ejecuciones,
  (select count(*) from ronda_ejecucion_puntos)  as puntos;

select set_config('request.jwt.claims',
         json_build_object('sub', (select auth_user_id::text from _ctx),
                           'role', 'authenticated')::text,
         true);

-- Ronda activa de OTRO puesto: no debe poder iniciarse.
insert into _r
select '1_ronda_de_otro_puesto', to_jsonb(
  iniciar_ronda((select ronda_otro_puesto_id from _ctx)) ->> 'contexto');
-- Esperado: "ronda_no_disponible"

-- Ronda del puesto correcto pero sin puntos activos.
create temp table _vacia on commit drop as
with nueva as (
  insert into rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, activo)
  select objetivo_id, puesto_id, 'ZZZ prueba fase1 sin puntos', 60, true from _ctx
  returning id
) select id from nueva;

insert into _r
select '2_ronda_sin_puntos', to_jsonb(
  iniciar_ronda((select id from _vacia)) ->> 'contexto');
-- Esperado: "ronda_sin_puntos"

insert into _r
select '3_no_se_creo_nada', jsonb_build_object(
  'ejecuciones_creadas',
    (select count(*) from ronda_ejecuciones) - (select ejecuciones from _antes),
  'puntos_creados',
    (select count(*) from ronda_ejecucion_puntos) - (select puntos from _antes));
-- Esperado: 0 y 0. Un rechazo no debe dejar rastro.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;   -- elimina también la ronda de prueba


-- ── 4.3 Sin sesión y sin turno ──────────────────────────────────────────────
-- No depende de que haya turnos vigentes: corre siempre.

begin;

create temp table _r (paso text primary key, resultado jsonb) on commit drop;

-- Sin claims: no hay usuario.
select set_config('request.jwt.claims', '', true);

insert into _r select '1_sin_sesion_consulta',
  to_jsonb(obtener_ejecucion_actual() ->> 'contexto');
-- Esperado: "sin_usuario"

-- Usuario válido pero sin turno vigente: el primero que no tenga turno activo.
select set_config('request.jwt.claims',
         json_build_object(
           'sub', (select u.auth_user_id::text from usuarios u
                    where u.estado = 'activo' and u.auth_user_id is not null
                      and not exists (
                        select 1 from turnos t
                         where t.guardia_id = u.id
                           and t.fecha in (
                                 ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
                                 ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1))
                           and (t.fecha + t.hora_inicio) <= (now() at time zone 'America/Argentina/Buenos_Aires')
                           and (now() at time zone 'America/Argentina/Buenos_Aires') < (
                                 t.fecha + t.hora_fin
                                 + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end))
                    limit 1),
           'role', 'authenticated')::text,
         true);

insert into _r select '2_sin_turno_consulta',
  to_jsonb(obtener_ejecucion_actual() ->> 'contexto');
-- Esperado: "sin_turno_vigente"

insert into _r select '3_sin_turno_iniciar',
  to_jsonb(iniciar_ronda((select id from rondas_base where activo limit 1)) ->> 'contexto');
-- Esperado: "sin_turno_vigente". Nunca "iniciada": sin turno no hay ronda.

insert into _r select '4_turno_vigente_filas',
  jsonb_build_object('filas', (select count(*) from rondas_turno_vigente()));
-- Esperado: 0 acá. Por el `limit 1` de la función, nunca puede pasar de 1.

select * from _r order by paso;   -- <<< copiar este resultado

rollback;


-- ── 4.4 Superficie de acceso de anon ────────────────────────────────────────
-- Cada operación debe FALLAR con insufficient_privilege. Las excepciones se
-- capturan para que la verificación completa continúe; cualquier éxito o error
-- distinto aborta el bloque y marca el fallo.

begin;

do $$
begin
  begin
    set local role anon;
    perform obtener_ejecucion_actual();
    raise exception 'FALLO: anon pudo ejecutar obtener_ejecucion_actual()';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado en obtener_ejecucion_actual() (SQLSTATE 42501)';
  end;

  begin
    set local role anon;
    perform iniciar_ronda(null);
    raise exception 'FALLO: anon pudo ejecutar iniciar_ronda(null)';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado en iniciar_ronda(null) (SQLSTATE 42501)';
  end;

  begin
    set local role anon;
    perform count(*) from ronda_ejecuciones;
    raise exception 'FALLO: anon pudo leer ronda_ejecuciones';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado al leer ronda_ejecuciones (SQLSTATE 42501)';
  end;

  begin
    set local role anon;
    perform count(*) from ronda_ejecucion_puntos;
    raise exception 'FALLO: anon pudo leer ronda_ejecucion_puntos';
  exception
    when insufficient_privilege then
      raise notice 'OK: anon bloqueado al leer ronda_ejecucion_puntos (SQLSTATE 42501)';
  end;
end;
$$;

rollback;

-- El vigilador autenticado, en cambio, SÍ puede ejecutar las RPC y NO puede
-- leer las tablas. Esperado: 0 y 0, sin error.
begin;
  set local role authenticated;
  select (select count(*) from ronda_ejecuciones)      as ejecuciones_visibles,
         (select count(*) from ronda_ejecucion_puntos) as puntos_visibles;
rollback;


/*
================================================================================
Consulta de referencia para etapas siguientes — ejecuciones abandonadas
================================================================================
No hace falta ninguna columna nueva ni un cron: una ejecución quedó abandonada
si sigue `en_curso` y la ventana de su turno ya terminó.

select e.id, e.guardia_id, e.fecha_operativa, e.iniciada_at
  from public.ronda_ejecuciones e
  join public.turnos t on t.id = e.turno_id
 where e.estado = 'en_curso'
   and (now() at time zone 'America/Argentina/Buenos_Aires') >= (
         t.fecha + t.hora_fin
         + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end);
================================================================================
*/
