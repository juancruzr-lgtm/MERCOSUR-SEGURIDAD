/*
  Fix C2 + Función unificada calcular_horas_liquidables

  PROBLEMA: La migración 20260716_horas_liquidables_asistencia.sql calculó
  horas_liquidables con valores negativos en turnos nocturnos. La causa:

    time + interval '1 day' en PostgreSQL devuelve time (wrappea a medianoche).
    '07:00'::time + interval '1 day' → '07:00'::time  (sin cambio)
    '07:00'::time - '21:00'::time   → interval '-14:00:00'

    Resultado: -14h programadas, valores imposibles en todo turno nocturno.

  SOLUCIÓN: usar extract(epoch from time) que devuelve segundos desde medianoche
  como entero, operar aritméticamente y sumar 86400 para cruce de medianoche.

  FUNCIÓN: calcular_horas_liquidables() implementa exactamente el mismo
  algoritmo que calcularHorasLiquidables() en lib/supabase.ts:
    - turno nocturno si hora_fin <= hora_inicio
    - entrada/salida absolutas con ajuste de 1440 min según posición nocturna
    - tolerancia 15 min: si |real - prog| <= 15 → liquida programado
    - resultado en horas, dos decimales

  ÚNICO ALGORITMO: toda consulta futura (trigger, reportes, correcciones)
  debe llamar a esta función en lugar de replicar la lógica.

  RECÁLCULO: resetea las 515 filas ya calculadas (con valores erróneos)
  y las recalcula usando la función.

  Idempotente: create or replace para la función; el reset+recálculo es
  seguro de repetir (deja los valores correctos sin importar el estado previo).
*/

-- ── Función unificada ─────────────────────────────────────────────────────
--
-- Parámetros (todos time, sin fecha — baseFecha cancela en las restas):
--   p_hora_inicio  hora_inicio del turno (turnos.hora_inicio)
--   p_hora_fin     hora_fin del turno    (turnos.hora_fin)
--   p_entrada      hora_entrada_final ?? hora_entrada_real
--   p_salida       hora_salida_final  ?? hora_salida_real
--
-- Devuelve NULL si algún parámetro es NULL (no lanza error).

create or replace function calcular_horas_liquidables(
  p_hora_inicio time,
  p_hora_fin    time,
  p_entrada     time,
  p_salida      time
)
returns numeric(6,2)
language plpgsql
immutable
as $$
declare
  v_inicio_min      int;
  v_fin_min         int;
  v_entrada_min     int;
  v_salida_min      int;
  v_turno_nocturno  bool;
  v_min_prog        int;
  v_entrada_abs     int;
  v_salida_abs      int;
  v_min_reales      int;
  v_min_liquidables int;
begin
  if p_hora_inicio is null or p_hora_fin is null
     or p_entrada is null or p_salida is null
  then
    return null;
  end if;

  -- Convertir a minutos desde medianoche (extract devuelve segundos)
  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;

  -- Nocturno: fin <= inicio (cruce de medianoche en el turno programado)
  v_turno_nocturno := v_fin_min <= v_inicio_min;

  -- Minutos programados (siempre positivo)
  v_min_prog := case when v_turno_nocturno
                  then v_fin_min + 1440 - v_inicio_min
                  else v_fin_min - v_inicio_min
                end;

  -- Entrada absoluta: si el guardia fichó en la parte AM de un turno nocturno
  -- (hora <= fin del turno), su entrada pertenece al día siguiente
  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then
    v_entrada_abs := v_entrada_abs + 1440;
  end if;

  -- Salida absoluta: si el guardia salió antes del inicio del turno nocturno
  -- (hora <= inicio), su salida es del día siguiente
  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then
    v_salida_abs := v_salida_abs + 1440;
  end if;
  -- Catch-all: si salida aún es menor que entrada, cruza medianoche
  if v_salida_abs < v_entrada_abs then
    v_salida_abs := v_salida_abs + 1440;
  end if;

  v_min_reales      := greatest(0, v_salida_abs - v_entrada_abs);

  -- Tolerancia 15 min: diferencia <= 15 → liquidar programado; si no → real
  v_min_liquidables := case when abs(v_min_prog - v_min_reales) <= 15
                         then v_min_prog
                         else v_min_reales
                       end;

  return round(cast(v_min_liquidables as numeric) / 60.0, 2);
end;
$$;

-- ── Reset de filas procesadas con valores erróneos ────────────────────────
--
-- Las 515 filas calculadas por C2 tienen valores negativos en turnos
-- nocturnos. Se ponen a NULL para que el backfill las recalcule.
-- Filas sin horas_liquidables (nunca procesadas) no se tocan.

update registros_asistencia
set horas_liquidables = null
where horas_liquidables is not null;

-- ── Recálculo con la función corregida ────────────────────────────────────
--
-- Solo filas con entrada y salida definidas.
-- Solo filas con horas_liquidables IS NULL (idempotente).
-- No modifica hora_entrada_real, hora_salida_real, hora_entrada_final,
-- hora_salida_final ni horas_trabajadas.

update registros_asistencia r
set horas_liquidables = calcular_horas_liquidables(
  t.hora_inicio,
  t.hora_fin,
  coalesce(r.hora_entrada_final, r.hora_entrada_real),
  coalesce(r.hora_salida_final,  r.hora_salida_real)
)
from turnos t
where t.id = r.turno_id
  and coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
  and coalesce(r.hora_salida_final,  r.hora_salida_real)  is not null
  and r.horas_liquidables is null;

-- ── Verificación post-ejecución ───────────────────────────────────────────
--
-- Ejecutar en SQL Editor después de aplicar esta migración:
--
-- select
--   count(*)                                             as total,
--   count(horas_liquidables)                             as con_valor,
--   count(*) filter (where horas_liquidables < 0)        as negativos,
--   count(*) filter (where horas_liquidables > 24)       as imposibles_altos
-- from registros_asistencia
-- where hora_entrada_real is not null
--   and hora_salida_real  is not null;
--
-- Resultado esperado: negativos = 0, imposibles_altos = 0.
