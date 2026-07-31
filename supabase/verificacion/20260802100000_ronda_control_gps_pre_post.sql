-- ============================================================================
-- VERIFICACIÓN pre/post de 20260802100000_ronda_control_gps_reincidencia
-- ============================================================================
--
-- SOLO LECTURA. Correr como `postgres` en el SQL Editor (RLS recortaría los
-- resultados con otra sesión). Bloques 1-3 sirven ANTES y DESPUÉS de aplicar
-- la migración; el resto solo después.

-- ── 1. Estructura esperada ───────────────────────────────────────────────────
-- ANTES: tabla_control = 0, col_snapshot = 0.
-- DESPUÉS: tabla_control = 1, col_snapshot = 1.
select
  (select count(*) from pg_catalog.pg_class
    where relname = 'ronda_punto_control_gps'
      and relnamespace = 'public'::regnamespace)          as tabla_control,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'ronda_ejecucion_puntos'
      and column_name  = 'snap_foto_control_gps')          as col_snapshot;

-- ── 2. Funciones y grants ────────────────────────────────────────────────────
-- DESPUÉS: las cuatro funciones existen; el vigilador (authenticated) puede
-- ejecutar iniciar/registrar/detalle pero NO escribir la tabla de control.
select
  p.proname,
  has_function_privilege('authenticated', p.oid, 'execute') as ejecuta_authenticated
from pg_catalog.pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('iniciar_ronda', 'registrar_punto_ronda',
                    'rondas_ejecucion_json', 'rondas_ejecucion_detalle_supervisor')
order by p.proname;

select
  has_table_privilege('authenticated', 'public.ronda_punto_control_gps', 'select') as lee,
  has_table_privilege('authenticated', 'public.ronda_punto_control_gps', 'insert') as inserta,   -- esperado: false
  has_table_privilege('authenticated', 'public.ronda_punto_control_gps', 'update') as actualiza, -- esperado: false
  has_table_privilege('authenticated', 'public.ronda_punto_control_gps', 'delete') as borra;     -- esperado: false

-- ── 3. RLS activo ────────────────────────────────────────────────────────────
-- DESPUÉS: rowsecurity = true y una política de select.
select c.relname, c.relrowsecurity as rls_activo,
       (select count(*) from pg_policies pol
         where pol.schemaname = 'public' and pol.tablename = c.relname) as politicas
from pg_catalog.pg_class c
where c.relname = 'ronda_punto_control_gps'
  and c.relnamespace = 'public'::regnamespace;

-- ── 4. Las funciones nuevas referencian el snapshot ─────────────────────────
-- DESPUÉS: ambas filas en true. Si alguna da false, la migración no reemplazó
-- esa función (posible colisión con otra versión posterior).
select
  (position('snap_foto_control_gps' in pg_get_functiondef(
     'public.iniciar_ronda(uuid)'::regprocedure)) > 0)          as iniciar_congela_flag,
  (position('ronda_punto_control_gps' in pg_get_functiondef(
     'public.registrar_punto_ronda(uuid,double precision,double precision,double precision,boolean)'::regprocedure)) > 0)
                                                                 as registrar_mueve_contador;

-- ── 5. Estado de las rachas ──────────────────────────────────────────────────
-- Inventario general. Recién migrado: cero filas (las rachas nacen con el
-- primer fuera-de-radio posterior al deploy, nunca por backfill).
select
  count(*)                                                as filas,
  count(*) filter (where foto_requerida_proxima_visita)   as con_foto_pendiente,
  coalesce(max(incumplimientos_consecutivos), 0)          as racha_maxima
from public.ronda_punto_control_gps;

-- ── 6. Coherencia racha ↔ historial ─────────────────────────────────────────
-- Cada racha > 0 debe estar respaldada por AL MENOS esa cantidad de visitas
-- fuera de radio del punto en el historial. Esperado: cero filas.
select cg.ronda_punto_id, cg.incumplimientos_consecutivos, h.fuera_de_radio_total
from public.ronda_punto_control_gps cg
join lateral (
  select count(*) as fuera_de_radio_total
  from public.ronda_ejecucion_puntos ep
  where ep.ronda_punto_id = cg.ronda_punto_id
    and ep.dentro_radio = false
) h on true
where cg.incumplimientos_consecutivos > h.fuera_de_radio_total;

-- ── 7. El contador no cuenta dos veces la misma visita ──────────────────────
-- ultimo_ejecucion_punto_id apunta a un punto ya registrado (no pendiente).
-- Esperado: cero filas.
select cg.ronda_punto_id, ep.estado
from public.ronda_punto_control_gps cg
join public.ronda_ejecucion_puntos ep on ep.id = cg.ultimo_ejecucion_punto_id
where ep.estado = 'pendiente';

-- ── 8. Ninguna alerta operativa nace de este mecanismo ──────────────────────
-- El evaluador no se tocó: los tipos de ronda_alertas siguen siendo los de
-- siempre. Esperado: cero filas con tipos fuera del vocabulario previo.
select tipo, count(*)
from public.ronda_alertas
where tipo not in ('no_iniciada', 'no_finalizada', 'suspendida')
group by tipo;

-- ── 9. La política manual no se alteró ──────────────────────────────────────
-- La migración no escribe ronda_puntos: la distribución de politica_foto debe
-- ser la misma que antes de aplicar. Comparar contra la corrida PRE.
select politica_foto, count(*)
from public.ronda_puntos
group by politica_foto
order by politica_foto;

-- ── 10. Recorrido del ciclo para UN punto (reemplazar :punto_id) ────────────
-- Auditoría manual del ciclo completo: las visitas del punto en orden con su
-- veredicto GPS, la exigencia congelada de cada una, y la racha vigente.
-- Lectura esperada del patrón:
--   fuera (false) → fuera (false) → visita con snap_foto_control_gps = true y
--   foto_ok = true → racha vuelve a 0.
--
-- select ep.registrado_at, ep.dentro_radio, ep.distancia_metros,
--        ep.snap_foto_control_gps, ep.foto_ok, ep.estado
-- from public.ronda_ejecucion_puntos ep
-- where ep.ronda_punto_id = :punto_id
--   and ep.registrado_at is not null
-- order by ep.registrado_at;
--
-- select * from public.ronda_punto_control_gps where ronda_punto_id = :punto_id;
