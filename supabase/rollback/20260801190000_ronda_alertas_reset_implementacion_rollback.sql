-- ============================================================================
-- ROLLBACK de 20260801190000_ronda_alertas_reset_implementacion
-- ============================================================================
--
-- Restituye `ronda_alertas` y `ronda_alerta_intervenciones` desde las tablas de
-- archivo, exactamente como estaban antes del reset: mismos ids, mismos estados,
-- mismas fechas, mismo historial de intervenciones.
--
-- Las tablas de archivo NO se borran acá. Se conservan hasta que el reset esté
-- validado; eliminarlas es una decisión aparte y manual (al pie hay dos DROP
-- comentados a propósito).
--
-- CONDICIÓN: solo restituye si las tablas vivas están vacías. Si el cron ya
-- generó alertas nuevas después del reset, este archivo aborta en vez de
-- mezclar mediciones viejas con las nuevas. Para forzar la restitución hay que
-- vaciar antes las tablas vivas, con decisión explícita.

begin;

do $$
declare
  v_a bigint; v_i bigint; v_aa bigint; v_ia bigint;
begin
  if to_regclass('public.ronda_alertas_archivo_20260801') is null then
    raise exception 'ABORTA: no existe ronda_alertas_archivo_20260801. No hay nada que restituir.';
  end if;

  select count(*) into v_a  from public.ronda_alertas;
  select count(*) into v_i  from public.ronda_alerta_intervenciones;

  if v_a <> 0 or v_i <> 0 then
    raise exception
      'ABORTA: las tablas vivas no están vacías (alertas %, intervenciones %). Restituir encima mezclaría el conjunto viejo con mediciones posteriores al reset.',
      v_a, v_i;
  end if;

  select count(*) into v_aa from public.ronda_alertas_archivo_20260801;
  select count(*) into v_ia from public.ronda_alerta_intervenciones_archivo_20260801;
  raise notice 'Restituyendo % alertas y % intervenciones desde el archivo.', v_aa, v_ia;
end;
$$;

-- Alertas primero: las intervenciones tienen FK contra ellas.
insert into public.ronda_alertas
  (id, objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
   tipo, ventana_inicio, ventana_fin, vencimiento_at, estado, detectada_at,
   resuelta_por, resuelta_at, accion, comentario, created_at, updated_at, motivo_vigilador)
select id, objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
       tipo, ventana_inicio, ventana_fin, vencimiento_at, estado, detectada_at,
       resuelta_por, resuelta_at, accion, comentario, created_at, updated_at, motivo_vigilador
from public.ronda_alertas_archivo_20260801;

insert into public.ronda_alerta_intervenciones
  (id, ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo, created_at)
select id, ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo, created_at
from public.ronda_alerta_intervenciones_archivo_20260801;

do $$
declare
  v_a bigint; v_aa bigint; v_i bigint; v_ia bigint;
begin
  select count(*) into v_a  from public.ronda_alertas;
  select count(*) into v_aa from public.ronda_alertas_archivo_20260801;
  select count(*) into v_i  from public.ronda_alerta_intervenciones;
  select count(*) into v_ia from public.ronda_alerta_intervenciones_archivo_20260801;

  if v_a <> v_aa or v_i <> v_ia then
    raise exception 'ABORTA: la restitución no coincide (alertas %/%, intervenciones %/%).',
      v_a, v_aa, v_i, v_ia;
  end if;

  raise notice 'Restitución verificada: % alertas, % intervenciones.', v_a, v_i;
end;
$$;

commit;

-- Solo cuando el reset esté validado y el archivo ya no haga falta:
-- drop table public.ronda_alerta_intervenciones_archivo_20260801;
-- drop table public.ronda_alertas_archivo_20260801;
