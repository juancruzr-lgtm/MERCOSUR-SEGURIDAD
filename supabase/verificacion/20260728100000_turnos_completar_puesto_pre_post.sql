-- ============================================================================
-- VERIFICACIÓN — turnos.puesto_id: completado, backfill y FK compuesta
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260728100000_turnos_completar_puesto.sql
-- TODO ESTE ARCHIVO ES DE SOLO LECTURA. Ejecutar por secciones.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Alcance del backfill. Debe coincidir con lo ya medido:
--     722 corregibles en 24 objetivos · 153 no corregibles en 6 objetivos.
select
  case
    when pa.activos = 1 then '1 puesto activo -> se corrige'
    when pa.activos = 0 then '0 puestos -> NO se toca'
    else format('%s puestos -> NO se toca (ambiguo)', pa.activos)
  end as caso,
  count(*)                       as turnos_sin_puesto,
  count(distinct t.objetivo_id)  as objetivos
from turnos t
join lateral (
  select count(*) filter (where p.activo) as activos
  from puestos p where p.objetivo_id = t.objetivo_id
) pa on true
where t.puesto_id is null
group by 1
order by 2 desc;


-- 1.2 PUNTO 4 — Los seis objetivos sin puestos activos.
--     Estos NO reciben puestos inventados. Sus turnos quedan sin modificar.
--     La lista es para que decidas a cuáles crearles un puesto.
select
  o.id                                   as objetivo_id,
  o.nombre                               as objetivo,
  o.estado,
  count(t.id)                            as turnos_sin_puesto,
  max(t.fecha)                           as turno_mas_reciente,
  (select count(*) from puestos p
    where p.objetivo_id = o.id)          as puestos_totales_incluyendo_inactivos
from objetivos o
join turnos t on t.objetivo_id = o.id and t.puesto_id is null
where not exists (
  select 1 from puestos p where p.objetivo_id = o.id and p.activo
)
group by o.id, o.nombre, o.estado
order by turnos_sin_puesto desc;


-- 1.3 Precondición de la FK compuesta. Debe dar 0.
select count(*) as turnos_con_puesto_de_otro_objetivo
  from turnos t
  join puestos p on p.id = t.puesto_id
 where p.objetivo_id is distinct from t.objetivo_id;


-- 1.4 El índice de respaldo debe existir (lo creó la migración de rondas).
select count(*) as indice_puestos_id_objetivo
  from pg_class
 where relname = 'puestos_id_objetivo_unique'
   and relnamespace = 'public'::regnamespace;


-- 1.5 Estado actual de LA CASONA, para comparar después.
select t.id as turno_id, t.fecha, t.hora_inicio, t.hora_fin,
       t.estado, t.puesto_id, t.guardia_id
  from turnos t
  join objetivos o on o.id = t.objetivo_id
 where o.nombre ilike '%casona%'
   and t.fecha >= (current_date - 3)
 order by t.fecha desc, t.hora_inicio;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 PUNTO 5 — Resumen del resultado.
--     Esperado: corregidos = 722 · sin_puesto_restantes = 153
--     y los 153 deben ser exactamente los de objetivos sin puestos activos.
select
  (select count(*) from turnos_puesto_backfill_20260728)   as corregidos,
  (select count(*) from turnos where puesto_id is null)    as sin_puesto_restantes,
  (select count(*) from turnos t
     where t.puesto_id is null
       and not exists (select 1 from puestos p
                        where p.objetivo_id = t.objetivo_id and p.activo))
                                                            as restantes_por_objetivo_sin_puestos;


-- 2.2 No debe quedar ningún turno corregible sin corregir. Esperado: 0.
select count(*) as corregibles_sin_corregir
from turnos t
join lateral (
  select count(*) filter (where p.activo) as activos
  from puestos p where p.objetivo_id = t.objetivo_id
) pa on true
where t.puesto_id is null and pa.activos = 1;


-- 2.3 LA CASONA con su puesto asignado. Esperado: puesto_id no nulo.
select t.id as turno_id, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
       t.puesto_id, p.nombre as puesto, t.guardia_id
  from turnos t
  join objetivos o on o.id = t.objetivo_id
  left join puestos p on p.id = t.puesto_id
 where o.nombre ilike '%casona%'
   and t.fecha >= (current_date - 3)
 order by t.fecha desc, t.hora_inicio;


-- 2.4 Ningún turno vinculado a un puesto de otro objetivo. Esperado: 0.
select count(*) as turnos_con_puesto_de_otro_objetivo
  from turnos t
  join puestos p on p.id = t.puesto_id
 where p.objetivo_id is distinct from t.objetivo_id;


-- 2.5 Estructura: la FK simple ya no está, la compuesta sí, el trigger activo.
select
  (select count(*) from pg_constraint
    where conrelid='public.turnos'::regclass and conname='turnos_puesto_id_fkey')       as fk_simple_debe_ser_0,
  (select count(*) from pg_constraint
    where conrelid='public.turnos'::regclass and conname='turnos_puesto_objetivo_fkey') as fk_compuesta_debe_ser_1,
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid='public.turnos'::regclass and conname='turnos_puesto_objetivo_fkey') as definicion_fk,
  (select count(*) from pg_trigger
    where tgrelid='public.turnos'::regclass and tgname='trg_turnos_completar_puesto')   as trigger_debe_ser_1;

-- En `definicion_fk` NO debe aparecer ON DELETE: la FK original era NO ACTION
-- y ese comportamiento se preserva.


-- 2.6 PUNTO 5 — La RPC del vigilador ya no debe devolver `turno_sin_puesto`.
--     Reemplazar el id por el del vigilador de LA CASONA. Rollback al final:
--     no modifica nada.
/*
begin;
  select set_config('request.jwt.claims',
    json_build_object(
      'sub', (select auth_user_id::text from usuarios where id = '<UUID_DEL_VIGILADOR>'),
      'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
  select obtener_rondas_guardia_actual() -> 'contexto' as contexto;
rollback;
*/
-- Esperado: 'ok' si el puesto tiene rondas configuradas, o 'puesto_sin_rondas'
-- si todavía no las tiene. Lo que NO debe volver a aparecer es 'turno_sin_puesto'.


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — Pruebas del trigger, sin dejar datos
-- ════════════════════════════════════════════════════════════════════════════
-- Cada bloque termina en rollback: no persiste ningún turno de prueba.

-- 3.1 Objetivo con 1 puesto activo -> el trigger completa solo.
begin;
  insert into turnos (objetivo_id, fecha, hora_inicio, hora_fin, estado)
  select o.id, current_date + 400, '06:00', '14:00', 'descubierto'
    from objetivos o
   where exists (select 1 from puestos p
                  where p.objetivo_id = o.id and p.activo
                  group by p.objetivo_id having count(*) = 1)
   limit 1
  returning id, objetivo_id, puesto_id;   -- puesto_id NO debe ser null
rollback;

-- 3.2 Objetivo sin puestos activos -> queda null, sin error.
begin;
  insert into turnos (objetivo_id, fecha, hora_inicio, hora_fin, estado)
  select o.id, current_date + 400, '06:00', '14:00', 'descubierto'
    from objetivos o
   where not exists (select 1 from puestos p where p.objetivo_id = o.id and p.activo)
   limit 1
  returning id, objetivo_id, puesto_id;   -- puesto_id debe ser null
rollback;

-- 3.3 La FK compuesta rechaza un puesto de otro objetivo.
--     Esperado: error de violación de clave foránea.
begin;
  insert into turnos (objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado)
  select t.objetivo_id, p.id, current_date + 400, '06:00', '14:00', 'descubierto'
    from (select id as objetivo_id from objetivos limit 1) t
    cross join lateral (
      select p.id from puestos p where p.objetivo_id <> t.objetivo_id limit 1
    ) p;
rollback;

-- 3.4 Caso "2 o más puestos activos": hoy no existe ningún objetivo así en
--     producción, por lo que el trigger deja null y la validación queda en la
--     aplicación. Se prueba desde la interfaz creando un segundo puesto en un
--     objetivo de prueba y verificando que aparece el selector y que no deja
--     guardar sin elegir. Recordá desactivar ese puesto al terminar.
-- ============================================================================
