/*
  C2 — Persistir horas liquidables en registros_asistencia

  Agrega la columna horas_liquidables a registros_asistencia y la
  populea para registros históricos ya existentes.

  Lógica: equivalente a calcularHorasLiquidables() en lib/supabase.ts:
    - entrada = hora_entrada_final ?? hora_entrada_real
    - salida  = hora_salida_final  ?? hora_salida_real
    - nocturno si hora_fin <= hora_inicio en el turno (cruce de medianoche)
    - tolerancia 15 minutos: si |real - programado| <= 15 → liquida programado
    - resultado en horas con dos decimales

  Backfill: solo registros con entrada y salida definidas y que no tengan
  horas_liquidables ya calculadas (idempotente).

  EJECUTAR LAS QUERIES DE VERIFICACIÓN PRIMERO antes del backfill.
  Ver sección "Verificación previa" al final de este archivo.

  Idempotente: usa ADD COLUMN IF NOT EXISTS. El UPDATE solo toca filas
  con horas_liquidables IS NULL.
*/

-- ── Columna ───────────────────────────────────────────────────────────────

alter table registros_asistencia
  add column if not exists horas_liquidables numeric(6,2);

comment on column registros_asistencia.horas_liquidables is
  'Horas a liquidar al empleado. Usa hora_entrada/salida_final si existe, '
  'si no la real. Tolerancia 15 min: si diferencia con programado es <= 15 '
  'min se liquida el programado, de lo contrario se liquida lo real.';

-- ── Backfill ──────────────────────────────────────────────────────────────
/*
  PASO PREVIO — ejecutar estas queries de verificación en Supabase SQL Editor
  antes de correr el UPDATE de backfill:

  -- 1. Registros candidatos (con entrada y salida definidas, sin horas_liquidables)
  select count(*) as candidatos
  from registros_asistencia r
  join turnos t on t.id = r.turno_id
  where coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
    and coalesce(r.hora_salida_final,  r.hora_salida_real)  is not null
    and r.horas_liquidables is null;

  -- 2. Candidatos que son turnos nocturnos (hora_fin <= hora_inicio)
  select count(*) as nocturnos
  from registros_asistencia r
  join turnos t on t.id = r.turno_id
  where coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
    and coalesce(r.hora_salida_final,  r.hora_salida_real)  is not null
    and r.horas_liquidables is null
    and t.hora_fin <= t.hora_inicio;

  -- 3. Después del backfill: valores fuera de rango (posible dato corrupto)
  select count(*) as fuera_de_rango
  from registros_asistencia
  where horas_liquidables is not null
    and (horas_liquidables < 0 or horas_liquidables > 24);

  -- 4. Vista previa del cálculo (muestra las primeras 20 filas candidatas)
  with calc as (
    select
      r.id,
      t.hora_inicio,
      t.hora_fin,
      coalesce(r.hora_entrada_final, r.hora_entrada_real) as entrada,
      coalesce(r.hora_salida_final,  r.hora_salida_real)  as salida,
      t.hora_fin <= t.hora_inicio                          as es_nocturno,
      extract(epoch from (
        case when t.hora_fin <= t.hora_inicio
          then t.hora_fin + interval '1 day' - t.hora_inicio
          else t.hora_fin - t.hora_inicio
        end
      )) / 60                                              as min_programados
    from registros_asistencia r
    join turnos t on t.id = r.turno_id
    where coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
      and coalesce(r.hora_salida_final,  r.hora_salida_real)  is not null
      and r.horas_liquidables is null
    limit 20
  ),
  con_reales as (
    select *,
      extract(epoch from (
        case when salida < entrada
          then salida + interval '1 day' - entrada
          else salida - entrada
        end
      )) / 60 as min_reales
    from calc
  )
  select
    id,
    hora_inicio, hora_fin,
    entrada, salida,
    es_nocturno,
    round(min_programados::numeric, 1)  as min_prog,
    round(min_reales::numeric, 1)       as min_real,
    round(
      case when abs(min_programados - min_reales) <= 15
        then min_programados
        else min_reales
      end / 60.0,
      2
    )                                   as horas_liquidables_calc
  from con_reales;
*/

-- ── UPDATE backfill ───────────────────────────────────────────────────────
-- Idempotente: solo actualiza filas donde horas_liquidables IS NULL.
-- Algoritmo:
--   1. Determina si el turno es nocturno (hora_fin <= hora_inicio).
--   2. Calcula minutos programados ajustando cruce de medianoche.
--   3. Calcula minutos reales: si salida < entrada, asume cruce de medianoche.
--   4. Aplica tolerancia de 15 min: si |programado - real| <= 15 → usa prog.
--   5. Resultado dividido en horas con dos decimales.

update registros_asistencia r
set horas_liquidables = sub.horas_liq
from (
  with base as (
    select
      r2.id,
      coalesce(r2.hora_entrada_final, r2.hora_entrada_real) as entrada,
      coalesce(r2.hora_salida_final,  r2.hora_salida_real)  as salida,
      extract(epoch from (
        case when t.hora_fin <= t.hora_inicio
          then t.hora_fin + interval '1 day' - t.hora_inicio
          else t.hora_fin - t.hora_inicio
        end
      )) / 60                                                as min_prog
    from registros_asistencia r2
    join turnos t on t.id = r2.turno_id
    where coalesce(r2.hora_entrada_final, r2.hora_entrada_real) is not null
      and coalesce(r2.hora_salida_final,  r2.hora_salida_real)  is not null
      and r2.horas_liquidables is null
  ),
  con_real as (
    select
      id, min_prog,
      extract(epoch from (
        case when salida < entrada
          then salida + interval '1 day' - entrada
          else salida - entrada
        end
      )) / 60 as min_real
    from base
  )
  select
    id,
    round(
      cast(
        case when abs(min_prog - min_real) <= 15
          then min_prog
          else min_real
        end / 60.0
      as numeric),
      2
    ) as horas_liq
  from con_real
) sub
where r.id = sub.id;
