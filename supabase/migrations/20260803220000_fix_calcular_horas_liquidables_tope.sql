/*
  FIX: calcular_horas_liquidables — tope de horas al turno programado

  BUG CORREGIDO:
  Cuando |real - programado| > 15 min de tolerancia, la función devolvía
  las horas reales sin límite. Un guardia que salía 2h después del turno
  se le liquidaban 10h en lugar de 8h.

  CORRECCIÓN:
  En la rama "fuera de tolerancia", se aplica LEAST(real, programado).
  Las horas liquidables NUNCA superan el turno programado.

  Solo un cierre de turno explícito por supervisor (cerrar_turno RPC)
  puede autorizar más horas, y esa RPC usa aritmética propia — no
  llama a esta función.

  IMPACTO:
  - corregir_registro_asistencia: usará la función corregida.
  - cerrar_turnos_abiertos: usará la función corregida.
  - registrar_cobertura: NO usa esta función (calcula duración programada).
  - cerrar_turno: NO usa esta función (aritmética del tramo aprobado).
  - Path 2 de horasLiquidablesRegistro (TS): usa calcularHorasLiquidables
    que fue corregida con Math.min en el mismo commit.

  IDEMPOTENTE: CREATE OR REPLACE, sin cambio de firma.
  NO MODIFICA DATOS: solo redefine la función. El backfill de datos
  históricos se ejecuta en migraciones separadas por mes, con preview
  y aprobación.
*/

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

  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;

  v_turno_nocturno := v_fin_min <= v_inicio_min;

  v_min_prog := case when v_turno_nocturno
                  then v_fin_min + 1440 - v_inicio_min
                  else v_fin_min - v_inicio_min
                end;

  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then
    v_entrada_abs := v_entrada_abs + 1440;
  end if;

  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then
    v_salida_abs := v_salida_abs + 1440;
  end if;
  if v_salida_abs < v_entrada_abs then
    v_salida_abs := v_salida_abs + 1440;
  end if;

  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);

  v_min_liquidables := case when abs(v_min_prog - v_min_reales) <= 15
                         then v_min_prog
                         else least(v_min_reales, v_min_prog)
                       end;

  return round(cast(v_min_liquidables as numeric) / 60.0, 2);
end;
$$;
