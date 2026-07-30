-- ============================================================================
-- VERIFICACIÓN de las migraciones 20260801130000 → 20260801170000
-- ============================================================================
-- Bloques 1-4: ANTES de aplicar.  Bloques 5-11: DESPUÉS.
-- Correr como `postgres` en el SQL Editor. Ningún bloque escribe datos.
--
-- Migraciones cubiertas:
--   20260801130000  rondas_ventanas_programadas          (helper, definición única)
--   20260801140000  evaluar_ronda_alertas_correctivo     (es_prueba + suspendida)
--   20260801150000  resolver_ronda_alerta_correctivo     (cierre administrativo)
--   20260801160000  listar_rondas_programadas_objetivo   (historial completo)
--   20260801170000  listar_ronda_alertas_alcance         (alcance global)

-- ════════════════════════════ PRE ═══════════════════════════════════════════

-- ── 1. PRE — Estado de partida de las funciones ──────────────────────────────
-- Esperado: rondas_ventanas_programadas y listar_rondas_programadas_objetivo
-- ausentes (0); las otras tres presentes (1).
select
  count(*) filter (where proname = 'rondas_ventanas_programadas')        as ventanas_programadas,
  count(*) filter (where proname = 'listar_rondas_programadas_objetivo') as historial_programado,
  count(*) filter (where proname = 'evaluar_ronda_alertas')              as evaluador,
  count(*) filter (where proname = 'resolver_ronda_alerta')              as resolver,
  count(*) filter (where proname = 'listar_ronda_alertas_objetivo')      as listar_alertas
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';

-- ── 2. PRE — Baseline de alertas ─────────────────────────────────────────────
-- El correctivo del evaluador NO borra ni modifica alertas existentes: los
-- totales de este bloque tienen que seguir iguales en el bloque 8.
select
  count(*)                                     as total,
  count(*) filter (where estado = 'pendiente') as pendientes,
  count(*) filter (where estado = 'resuelta')  as resueltas,
  max(detectada_at)                            as ultima_deteccion
from public.ronda_alertas;

-- ── 3. PRE — Dependencias que las migraciones dan por existentes ─────────────
-- Esperado: todo true. Si `tiene_es_prueba` fuera false, aplicar antes
-- 20260717_objetivos_es_prueba.sql.
select
  to_regclass('public.ronda_alertas')               is not null as tabla_alertas,
  to_regclass('public.ronda_alerta_intervenciones') is not null as tabla_intervenciones,
  to_regclass('public.app_config')                  is not null as tabla_app_config,
  exists(select 1 from information_schema.columns
          where table_schema='public' and table_name='objetivos'
            and column_name='es_prueba')                        as tiene_es_prueba,
  exists(select 1 from information_schema.columns
          where table_schema='public' and table_name='rondas_base'
            and column_name='puesto_id')                        as rondas_base_puesto,
  exists(select 1 from information_schema.columns
          where table_schema='public' and table_name='rondas_base'
            and column_name='hora_inicio')                      as rondas_base_hora;

-- ── 4. PRE — Cuánto ruido va a dejar de generarse ────────────────────────────
-- Cuantifica lo que el correctivo evita a futuro. No es una promesa de borrado:
-- las alertas ya creadas siguen donde están.
select
  (select count(*) from public.ronda_alertas a
     join public.objetivos ob on ob.id = a.objetivo_id
    where ob.es_prueba and a.estado = 'pendiente')          as pendientes_de_prueba,
  (select count(*) from public.ronda_alertas a
    where a.tipo = 'no_iniciada' and a.estado = 'pendiente'
      and exists (select 1 from public.ronda_alertas s
                   where s.ronda_base_id = a.ronda_base_id
                     and s.turno_id = a.turno_id
                     and s.tipo = 'suspendida'))            as no_iniciada_por_suspension;

-- ════════════════════════════ POST ══════════════════════════════════════════

-- ── 5. POST — Las cinco funciones quedaron instaladas ────────────────────────
-- Esperado: 5 filas. `ventanas_programadas` sin grants a authenticated.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       p.provolatile                             as volatilidad,
       has_function_privilege('authenticated', p.oid, 'execute') as puede_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rondas_ventanas_programadas', 'listar_rondas_programadas_objetivo',
                    'evaluar_ronda_alertas', 'resolver_ronda_alerta',
                    'listar_ronda_alertas_objetivo')
order by p.proname;
-- Esperado exacto:
--   rondas_ventanas_programadas        → puede_authenticated = false
--   listar_rondas_programadas_objetivo → puede_authenticated = true
--   evaluar_ronda_alertas              → puede_authenticated = false (solo service_role)
--   resolver_ronda_alerta              → puede_authenticated = true
--   listar_ronda_alertas_objetivo      → puede_authenticated = true

-- ── 6. POST — El helper no expone objetivos de prueba en alcance completo ────
-- Esperado: 0 filas. Cualquier fila es una fuga del filtro es_prueba.
select distinct v.objetivo_id, ob.nombre
from public.rondas_ventanas_programadas(null, current_date - 2, current_date) v
join public.objetivos ob on ob.id = v.objetivo_id
where ob.es_prueba;

-- ── 7. POST — El historial deriva de programación, NO de alertas ─────────────
-- Requisito central: las filas y sus estados no dependen de ronda_alertas.
-- Para cada objetivo con rondas, compara la cantidad de ventanas que devuelve el
-- helper con la cantidad de filas que devuelve la RPC de historial.
--
-- Esperado: ventanas = filas_historial en todos los casos, INCLUSO en objetivos
-- sin ninguna alerta registrada (columna `alertas_del_objetivo` = 0).
select
  ob.nombre                                                          as objetivo,
  (select count(*) from public.rondas_ventanas_programadas(ob.id, current_date - 7, current_date)) as ventanas,
  jsonb_array_length(
    public.listar_rondas_programadas_objetivo(ob.id, current_date - 7, current_date) -> 'rondas'
  )                                                                  as filas_historial,
  (select count(*) from public.ronda_alertas a where a.objetivo_id = ob.id) as alertas_del_objetivo
from public.objetivos ob
where exists (select 1 from public.rondas_base rb where rb.objetivo_id = ob.id and rb.activo)
order by ob.nombre;

-- ── 8. POST — El correctivo no tocó datos existentes ─────────────────────────
-- Comparar contra el bloque 2. Esperado: total y resueltas idénticos.
-- `pendientes` puede subir solo si el evaluador corrió entre ambas mediciones.
select
  count(*)                                     as total,
  count(*) filter (where estado = 'pendiente') as pendientes,
  count(*) filter (where estado = 'resuelta')  as resueltas,
  max(detectada_at)                            as ultima_deteccion
from public.ronda_alertas;

-- ── 9. POST — Historial y alertas no se contradicen ──────────────────────────
-- Ambos derivan del mismo conjunto de ventanas. Cada alerta `no_iniciada`
-- pendiente debe tener su ventana en el historial del objetivo.
--
-- Esperado: 0 filas. Una fila = una alerta cuya ventana el historial no reconoce,
-- es decir las dos definiciones volvieron a divergir.
select a.id, ob.nombre as objetivo, rb.nombre as ronda, a.ventana_inicio
from public.ronda_alertas a
join public.objetivos   ob on ob.id = a.objetivo_id
join public.rondas_base rb on rb.id = a.ronda_base_id
where a.estado = 'pendiente'
  and a.tipo   = 'no_iniciada'
  and a.ventana_inicio >= (current_date - 2)::timestamptz
  and not exists (
    select 1
    from public.rondas_ventanas_programadas(a.objetivo_id, current_date - 2, current_date) v
    where v.ronda_base_id  = a.ronda_base_id
      and v.turno_id       = a.turno_id
      and v.ventana_inicio = a.ventana_inicio
  );

-- ── 10. POST — El evaluador es idempotente y no rompe ────────────────────────
-- Correr dos veces seguidas. Esperado: no lanza excepción y la segunda corrida
-- no crea filas nuevas (`total` igual antes y después).
select (select count(*) from public.ronda_alertas) as total_antes,
       public.evaluar_ronda_alertas()              as afectadas_1,
       public.evaluar_ronda_alertas()              as afectadas_2,
       (select count(*) from public.ronda_alertas) as total_despues;

-- ── 11. POST — Retrocompatibilidad del listado de alertas ────────────────────
-- La ampliación no debe cambiar el resultado por objetivo. Para cada objetivo,
-- las alertas devueltas con filtro explícito tienen que ser un subconjunto
-- exacto de las devueltas por el alcance completo.
--
-- Esperado: 0 filas. Correr con sesión de un supervisor real para probar también
-- el recorte por zona (con `postgres` no hay auth.uid() y devuelve sin_usuario).
with alcance as (
  select (jsonb_array_elements(
           public.listar_ronda_alertas_objetivo(null, 'pendiente') -> 'alertas'
         ) ->> 'id')::uuid as id
),
por_objetivo as (
  select (jsonb_array_elements(
           public.listar_ronda_alertas_objetivo(ob.id, 'pendiente') -> 'alertas'
         ) ->> 'id')::uuid as id
  from public.objetivos ob
  where ob.es_prueba = false
)
select p.id as en_objetivo_pero_no_en_alcance
from por_objetivo p
where not exists (select 1 from alcance a where a.id = p.id);
