-- ============================================================================
-- ETAPA 3.3 — Supervisor de Rondas · Bloque B0′
-- RPC de LECTURA autorizada: HISTORIAL de ejecuciones finalizadas de un objetivo.
-- ============================================================================
--
-- Objetivo: alimentar la sección "Historial" del panel de Rondas dentro del
-- Centro Operativo de UN objetivo. Devuelve solo ejecuciones nativas
-- FINALIZADAS de ese objetivo, en un rango de fechas obligatorio.
--
-- Alcance de este bloque:
--   · SOLO agrega esta función de lectura. No crea ni modifica tablas, columnas,
--     RLS, grants de tablas, ni ninguna otra RPC.
--   · No toca B1 (rondas_ejecucion_detalle_supervisor), ni la RPC de en curso,
--     ni la del vigilador, ni JWM/rondas_jwm, ni asistencia/liquidables.
--
-- Seguridad:
--   · SECURITY DEFINER con search_path fijo (evita search_path injection).
--   · Identidad desde auth.uid(); autorización por
--     `puede_administrar_rondas_objetivo(p_objetivo_id)` ANTES de exponer datos.
--   · Solo lectura (stable). El objetivo se pasa como parámetro pero el acceso
--     se valida contra la zona del supervisor: no se puede pedir un objetivo
--     ajeno. No mezcla objetivos: filtra por p_objetivo_id.
--   · revoke public/anon; grant execute a authenticated.
--
-- Reglas:
--   · Solo estado = 'finalizada' (excluye 'en_curso' y 'cancelada').
--   · Rango [p_desde, p_hasta] obligatorio y validado (ambos no nulos y
--     p_desde <= p_hasta); se filtra por fecha_operativa (día operativo).
--   · Orden descendente por iniciada_at.
--   · cerrada_por IS NOT NULL distingue el cierre administrativo de una ronda
--     que el vigilador terminó con puntos incumplidos.
--
-- Contexto devuelto:
--   'ok' | 'sin_usuario' | 'rango_invalido' | 'sin_permiso'
-- ============================================================================

begin;

create or replace function public.listar_ejecuciones_objetivo(
  p_objetivo_id uuid,
  p_desde       date,
  p_hasta       date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  -- 1. Sesión.
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'ejecuciones', jsonb_build_array());
  end if;

  -- 2. Rango obligatorio y coherente (antes de tocar datos).
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    return jsonb_build_object('contexto', 'rango_invalido', 'ejecuciones', jsonb_build_array());
  end if;

  -- 3. Autorización: admin, o supervisor con la zona del objetivo asignada.
  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'ejecuciones', jsonb_build_array());
  end if;

  -- 4. Historial finalizado del objetivo en el rango, con conteos por punto.
  return jsonb_build_object(
    'contexto', 'ok',
    'ejecuciones', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ejecucion_id',             e.id,
          'ronda_id',                 e.ronda_base_id,
          'ronda_nombre',             e.snap_ronda_nombre,
          'puesto_id',                e.puesto_id,
          'puesto_nombre',            pu.nombre,
          'guardia_id',               e.guardia_id,
          'guardia_nombre',           g.apellido || ', ' || g.nombre,
          'estado',                   e.estado,
          'resultado',                e.resultado,
          'iniciada_at',              e.iniciada_at,
          'finalizada_at',            e.finalizada_at,
          'puntos_total',             e.puntos_total,
          'puntos_cumplidos',         cnt.cumplidos,
          'puntos_incumplidos',       cnt.incumplidos,
          'puntos_omitidos',          cnt.omitidos,
          'cerrada_por',              e.cerrada_por,
          'cerrada_at',               e.cerrada_at,
          'cerrada_motivo',           e.cerrada_motivo,
          'es_cierre_administrativo', (e.cerrada_por is not null)
        )
        order by e.iniciada_at desc
      )
      from public.ronda_ejecuciones e
      join public.puestos  pu on pu.id = e.puesto_id
      join public.usuarios g  on g.id  = e.guardia_id
      cross join lateral (
        select
          count(*) filter (where ep.estado = 'cumplido')   as cumplidos,
          count(*) filter (where ep.estado = 'incumplido') as incumplidos,
          count(*) filter (where ep.estado = 'omitido')    as omitidos
        from public.ronda_ejecucion_puntos ep
        where ep.ronda_ejecucion_id = e.id
      ) cnt
      where e.objetivo_id     = p_objetivo_id
        and e.estado          = 'finalizada'
        and e.fecha_operativa between p_desde and p_hasta
    ), jsonb_build_array())
  );
end;
$$;

revoke all on function public.listar_ejecuciones_objetivo(uuid, date, date) from public;
revoke all on function public.listar_ejecuciones_objetivo(uuid, date, date) from anon;
grant execute on function public.listar_ejecuciones_objetivo(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
