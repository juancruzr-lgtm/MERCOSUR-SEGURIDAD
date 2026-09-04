-- ============================================================================
-- ROLLBACK · 20260904100000_novedad_mensual_informada
-- ============================================================================
-- Elimina el soporte de novedad mensual informada. OJO: si existen filas
-- importadas (origen_carga='importacion_mensual'), este rollback las marca
-- 'rechazada' antes de quitar las columnas — el registro se conserva en
-- observacion, nunca se borra.
-- ============================================================================

begin;

update public.novedades_laborales
set estado = 'rechazada',
    observacion = coalesce(observacion || ' · ', '')
      || '[rollback 20260904100000: era importacion_mensual con dias_informados='
      || coalesce(dias_informados::text, 'null') || ', origen=' || coalesce(origen_detalle, 'null') || ']'
where origen_carga = 'importacion_mensual';

alter table public.novedades_laborales
  drop constraint if exists novedades_laborales_mensual_con_cantidad;
alter table public.novedades_laborales
  drop constraint if exists novedades_laborales_origen_carga_valido;
alter table public.novedades_laborales
  drop constraint if exists novedades_laborales_dias_informados_rango;

alter table public.novedades_laborales
  drop column if exists dias_informados,
  drop column if exists origen_carga,
  drop column if exists origen_detalle;

notify pgrst, 'reload schema';

commit;
