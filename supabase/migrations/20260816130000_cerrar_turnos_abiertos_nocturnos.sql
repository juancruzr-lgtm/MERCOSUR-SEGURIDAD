-- cerrar_turnos_abiertos(): arreglar el fin de los turnos nocturnos
-- APLICADA EN PRODUCCION: 2026-08-13 (SQL editor), antes de los turnos de la noche.
-- Verificado post: pg_get_functiondef contiene el CASE WHEN; cron reagendado.
-- Alcance del bug al momento de arreglarlo: 103 de los 203 cierres automaticos
-- historicos eran nocturnos, todos cerrados antes de tiempo.
--
-- EL BUG
-- La version original (20260721) calculaba el fin del turno asi:
--
--   (t.fecha || ' ' || t.hora_fin)::timestamp AT TIME ZONE 'America/...'
--
-- Eso solo vale cuando el turno empieza y termina el mismo dia. Un turno
-- nocturno 19:00 -> 07:00 con fecha 2026-08-13 termina el 2026-08-14 a las
-- 07:00, pero la expresion daba 2026-08-13 07:00: DOCE HORAS ANTES de que el
-- turno empezara.
--
-- Consecuencia: un turno nocturno cumplia "termino hace mas de 30 minutos"
-- desde el momento en que existia. Apenas el vigilador fichaba entrada, la
-- siguiente corrida lo cerraba —hora_salida_final = hora_fin y las horas
-- completas del turno— con la persona todavia trabajando. El turno figuraba
-- terminado toda la noche.
--
-- Mientras nadie ejecutaba la funcion el bug no se notaba. Al agendarla en
-- pg_cron (20260816120000) pasa a dispararse cada 15 minutos, asi que se
-- corrige antes de la primera noche.
--
-- EL ARREGLO
-- Se suma un dia cuando hora_fin <= hora_inicio, que es exactamente el
-- criterio que ya usa aceptar_turno_planilla (20260805140000) para el mismo
-- calculo. Es la unica linea que cambia: filtros, accion y valor de retorno
-- quedan igual.
--
-- Turnos ya cerrados mal: esta migracion NO los toca. Como el cierre pone las
-- horas del turno PROGRAMADO, el monto liquidado coincide con lo que
-- corresponde; lo que quedo mal es el momento del cierre y la etiqueta de
-- origen. Corregir uno puntual va por el camino normal (correccion de horario
-- reconocido, con motivo y auditoria).
--
-- Para ver si hubo cierres afectados:
--
--   select count(*) as nocturnos_cerrados_automaticamente
--   from registros_asistencia r join turnos t on t.id = r.turno_id
--   where r.cierre_automatico and t.hora_fin <= t.hora_inicio;
--
-- Idempotente: CREATE OR REPLACE.
-- Rollback: supabase/rollback/20260816130000_cerrar_turnos_abiertos_nocturnos_rollback.sql

CREATE OR REPLACE FUNCTION cerrar_turnos_abiertos()
RETURNS TABLE (
  registros_cerrados  integer,
  detalle             text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count  integer := 0;
BEGIN
  WITH vencidos AS (
    SELECT
      r.id                    AS registro_id,
      r.hora_entrada_final,
      r.hora_entrada_real,
      t.hora_inicio,
      t.hora_fin
    FROM registros_asistencia r
    JOIN turnos t ON t.id = r.turno_id
    WHERE r.hora_entrada_real IS NOT NULL
      AND r.hora_salida_real  IS NULL
      AND r.hora_salida_final IS NULL
      AND r.cierre_automatico  = false
      -- Fin del turno como timestamptz en Buenos Aires, con 30 min de gracia.
      -- hora_fin <= hora_inicio significa turno nocturno: termina al dia
      -- siguiente. Mismo criterio que aceptar_turno_planilla.
      AND ((t.fecha + CASE WHEN t.hora_fin <= t.hora_inicio THEN 1 ELSE 0 END)::text
           || ' ' || t.hora_fin)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'
          < (now() - interval '30 minutes')
  ),
  cerrados AS (
    UPDATE registros_asistencia ra
    SET
      hora_salida_final  = v.hora_fin,
      horas_liquidables  = calcular_horas_liquidables(
                             v.hora_inicio,
                             v.hora_fin,
                             COALESCE(ra.hora_entrada_final, ra.hora_entrada_real),
                             v.hora_fin
                           ),
      cierre_automatico  = true
    FROM vencidos v
    WHERE ra.id = v.registro_id
    RETURNING ra.id
  )
  SELECT count(*)::integer INTO v_count FROM cerrados;

  RETURN QUERY SELECT v_count, (v_count || ' registro(s) cerrado(s) automáticamente')::text;
END;
$$;
