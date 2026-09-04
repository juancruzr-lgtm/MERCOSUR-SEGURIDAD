-- ============================================================================
-- NOVEDADES · Novedad mensual informada (cantidad de días sin fechas exactas)
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- La planilla mensual de Novedades que Administración maneja en Excel muchas
-- veces informa sólo una CANTIDAD ("VACACIONES = 2") sin decir qué días
-- fueron. El modelo actual exige fecha_desde/fecha_hasta y deriva
-- cantidad_dias de ese rango, así que representar "2 días de vacaciones en
-- agosto" obligaría a inventar fechas — y no inventamos datos.
--
-- La verdad disponible es: empleado + período + tipo + cantidad. Eso es lo
-- que se persiste:
--
--   * dias_informados  → la cantidad informada. Cuando está presente, los
--     consumidores (Resumen Guardia) usan ESTE número y no cantidad_dias.
--     fecha_desde/fecha_hasta pasan a ser el PERÍODO DE REFERENCIA (el mes),
--     no una afirmación de días puntuales.
--   * origen_carga     → 'app' (carga normal con fechas reales) o
--     'importacion_mensual' (vino de la planilla mensual).
--   * origen_detalle   → archivo/hoja/lote del que provino, para poder
--     reconstruir después de dónde salió cada dato.
--
-- DEDUPLICACIÓN (regla de importación, empleado + tipo + período):
--   * app N con fechas = Excel N            → conciliado, no se crea nada.
--   * app 0, Excel N                        → mensual informada por N.
--   * app X, Excel N>X                      → mensual informada por la
--     DIFERENCIA (N−X), con la cuenta explicada en observacion. Así el total
--     del período = exactas + informadas, sin doble conteo y auditable.
--   * app > Excel                           → no se reduce nada; diferencia a
--     revisión humana.
-- Los importadores marcan sus filas con origen_carga='importacion_mensual':
-- reimportar el mismo período detecta lo ya importado y no duplica.
--
-- QUÉ NO HACE
--   * No toca horas liquidables, jornadas ni feriados (las novedades nunca
--     mueven horas).
--   * No cambia ninguna fila existente: todo lo cargado hasta hoy queda como
--     origen 'app' con su semántica actual intacta.
--   * No abre permisos: novedades_laborales conserva sus políticas actuales.
-- ============================================================================

begin;

alter table public.novedades_laborales
  add column if not exists dias_informados integer,
  add column if not exists origen_carga    text not null default 'app',
  add column if not exists origen_detalle  text;

comment on column public.novedades_laborales.dias_informados is
  'Cantidad de días informada SIN fechas exactas (novedad mensual). Cuando '
  'está presente, los consumidores usan este número y fecha_desde/hasta son '
  'sólo el período de referencia (el mes), no días afirmados. NULL = novedad '
  'normal: la cantidad sale de las fechas (cantidad_dias).';

comment on column public.novedades_laborales.origen_carga is
  'De dónde salió la fila: app (carga normal) | importacion_mensual (planilla '
  'mensual de Novedades). Permite deduplicar y auditar importaciones.';

comment on column public.novedades_laborales.origen_detalle is
  'Identificación del origen concreto de una importación (archivo, hoja, '
  'lote). NULL para cargas normales de la app.';

alter table public.novedades_laborales
  add constraint novedades_laborales_dias_informados_rango
  check (dias_informados is null or (dias_informados >= 1 and dias_informados <= 31));

alter table public.novedades_laborales
  add constraint novedades_laborales_origen_carga_valido
  check (origen_carga in ('app', 'importacion_mensual'));

-- Una importación mensual tiene que decir cuánto (días u horas, según tipo).
alter table public.novedades_laborales
  add constraint novedades_laborales_mensual_con_cantidad
  check (
    origen_carga <> 'importacion_mensual'
    or dias_informados is not null
    or horas_afectadas is not null
  );

notify pgrst, 'reload schema';

commit;
