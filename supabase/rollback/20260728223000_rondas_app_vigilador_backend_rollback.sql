/*
================================================================================
ROLLBACK — Etapa 3.2, App Vigilador: soporte transaccional
================================================================================

Revierte:
  supabase/migrations/20260728223000_rondas_app_vigilador_backend.sql

El rollback se bloquea si ya se registraron puntos o evidencias de Rondas. En
ese caso hay historial operativo y eliminar la infraestructura sería destructivo.
================================================================================
*/

begin;

do $$
declare
  v_puntos_resueltos integer;
  v_evidencias       integer;
begin
  select count(*) into v_puntos_resueltos
    from public.ronda_ejecucion_puntos
   where estado <> 'pendiente';

  select count(*) into v_evidencias
    from public.evidencias
   where proceso_tipo = 'ronda';

  if v_puntos_resueltos > 0 or v_evidencias > 0 then
    raise exception
      'ROLLBACK BLOQUEADO: existen % punto(s) resuelto(s) y % evidencia(s) de ronda',
      v_puntos_resueltos,
      v_evidencias;
  end if;
end;
$$;

drop function if exists public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision
);
drop function if exists public.rondas_distancia_metros(
  double precision, double precision, double precision, double precision
);

drop trigger if exists trg_rondas_validar_evidencia_punto on public.evidencias;
drop function if exists public.rondas_validar_evidencia_punto();

delete from storage.objects where bucket_id = 'ronda-evidencias';
delete from storage.buckets where id = 'ronda-evidencias';

notify pgrst, 'reload schema';

commit;

/*
Verificación esperada:
  * registrar_punto_ronda(...) no existe.
  * rondas_distancia_metros(...) no existe.
  * trg_rondas_validar_evidencia_punto no existe.
  * el bucket ronda-evidencias no existe.
*/
