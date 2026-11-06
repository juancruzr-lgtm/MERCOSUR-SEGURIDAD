-- ============================================================================
-- ROLLBACK de 20261205130000_ronda_control_gps_reincidencia_v2.sql
-- Archivo aparte: NUNCA correrlo junto con la migración.
-- ============================================================================
--
-- Deja producción como estaba antes de la migración:
--   · rondas_ejecucion_json y rondas_ejecucion_detalle_supervisor vuelven a su
--     definición viva sin la clave 'foto_control_gps' (se quita exactamente la
--     línea que agregó la migración, desde la definición viva).
--   · se borran los dos triggers, sus funciones y la del umbral.
--   · se borra ronda_punto_control_gps (la racha es estado derivado: se pierde
--     sin consecuencias; las visitas en ronda_ejecucion_puntos no se tocan).
--   · se borra ronda_ejecucion_puntos.snap_foto_control_gps (se pierde sólo la
--     marca "esta visita pidió foto de control" de las visitas posteriores a la
--     migración; GPS, QR, fotos y veredictos de esas visitas quedan intactos).
--
-- No toca app_config: la migración tampoco la escribe.
-- ============================================================================

begin;

do $do$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.rondas_ejecucion_json(uuid)'::regprocedure);
  if position('foto_control_gps' in v_def) > 0 then
    execute regexp_replace(v_def, '''foto_control_gps'',\s+p\.snap_foto_control_gps,\s*\n\s*', '');
  end if;

  v_def := pg_get_functiondef('public.rondas_ejecucion_detalle_supervisor(uuid)'::regprocedure);
  if position('foto_control_gps' in v_def) > 0 then
    execute regexp_replace(v_def, '''foto_control_gps'',\s+ep\.snap_foto_control_gps,\s*\n\s*', '');
  end if;

  if position('foto_control_gps' in pg_get_functiondef('public.rondas_ejecucion_json(uuid)'::regprocedure)) > 0
     or position('foto_control_gps' in pg_get_functiondef('public.rondas_ejecucion_detalle_supervisor(uuid)'::regprocedure)) > 0 then
    raise exception 'rollback control_gps_v2: no se pudo quitar foto_control_gps de las funciones; revisar a mano';
  end if;
end
$do$;

drop trigger if exists trg_ronda_control_gps_transicion on public.ronda_ejecucion_puntos;
drop trigger if exists trg_ronda_control_gps_snapshot on public.ronda_ejecucion_puntos;
drop function if exists public.ronda_control_gps_transicion();
drop function if exists public.ronda_control_gps_snapshot();
drop function if exists public.ronda_control_gps_umbral();

drop table if exists public.ronda_punto_control_gps;

alter table public.ronda_ejecucion_puntos
  drop column if exists snap_foto_control_gps;

notify pgrst, 'reload schema';

commit;
