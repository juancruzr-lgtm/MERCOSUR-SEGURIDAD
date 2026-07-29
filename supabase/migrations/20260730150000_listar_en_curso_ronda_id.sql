-- ============================================================================
-- ETAPA 3.3 — Cierre operativo: agrega ronda_id a listar_ejecuciones_en_curso_objetivo
-- ============================================================================
--
-- Corrige la limitación detectada en B6: el mapa filtraba las ejecuciones EN
-- CURSO por nombre de ronda porque la RPC no exponía el id. Se agrega `ronda_id`
-- (= ronda_base_id) a la salida para poder filtrar por id, nunca por nombre.
--
-- Cambio ADITIVO: `create or replace` sobre la función existente. No modifica
-- tablas, RLS ni grants. Los consumidores actuales (RondasEnCursoPanel) no leen
-- ronda_id y no se ven afectados. Autorización y firma intactas.

begin;

create or replace function public.listar_ejecuciones_en_curso_objetivo(p_objetivo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ahora timestamp;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'ejecuciones', jsonb_build_array());
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'ejecuciones', jsonb_build_array());
  end if;

  v_ahora := (now() at time zone 'America/Argentina/Buenos_Aires');

  return jsonb_build_object(
    'contexto', 'ok',
    'ejecuciones', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',               e.id,
          'ronda_id',         e.ronda_base_id,
          'ronda_nombre',     e.snap_ronda_nombre,
          'guardia_nombre',   u.apellido || ', ' || u.nombre,
          'puesto_nombre',    p.nombre,
          'fecha_operativa',  e.fecha_operativa,
          'iniciada_at',      e.iniciada_at,
          'puntos_total',     e.puntos_total,
          'puntos_pendientes', (
            select count(*) from public.ronda_ejecucion_puntos ep
             where ep.ronda_ejecucion_id = e.id and ep.estado = 'pendiente'
          ),
          -- Una ejecución cuya ventana de turno ya terminó está abandonada, no
          -- en progreso. Es el dato que justifica cerrarla.
          'turno_vencido', v_ahora >= (
            t.fecha + t.hora_fin
            + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end
          )
        ) order by e.iniciada_at
      )
      from public.ronda_ejecuciones e
      join public.turnos   t on t.id = e.turno_id
      join public.usuarios u on u.id = e.guardia_id
      join public.puestos  p on p.id = e.puesto_id
      where e.objetivo_id = p_objetivo_id
        and e.estado = 'en_curso'
    ), jsonb_build_array())
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
