-- ============================================================================
-- ETAPA 3.3 — Supervisor de Rondas · Bloque B1
-- RPC de LECTURA autorizada: detalle completo de una ejecución de ronda.
-- ============================================================================
--
-- Objetivo: dar al supervisor/admin el detalle punto por punto de UNA ejecución
-- (en curso o finalizada), con GPS real, veredictos, novedades, tiempos, cierre
-- administrativo y referencias de evidencia.
--
-- Alcance de este bloque:
--   · SOLO agrega esta función de lectura. No crea ni modifica tablas, columnas,
--     RLS, grants de tablas, ni ninguna otra RPC.
--   · No firma URLs de fotos: devuelve solo REFERENCIAS de evidencia
--     (bucket + storage_path). El acceso al archivo se resuelve en el bloque B2.
--     El bucket 'ronda-evidencias' permanece privado.
--   · No toca la RPC del vigilador `rondas_ejecucion_json` (coexisten).
--
-- Seguridad:
--   · SECURITY DEFINER con search_path fijo (evita search_path injection).
--   · Identidad desde auth.uid(); autorización por
--     `puede_administrar_rondas_objetivo(<objetivo de la ejecución>)` ANTES de
--     exponer cualquier dato de la ejecución, sus puntos o sus evidencias.
--   · Solo lectura (stable). No acepta identidad ni alcance desde el cliente.
--   · revoke public/anon; grant execute a authenticated (la autorización real
--     se valida dentro de la función, no depende del grant).
--
-- Contexto devuelto:
--   'ok' | 'sin_usuario' | 'no_encontrada' | 'sin_permiso'
-- ============================================================================

begin;

create or replace function public.rondas_ejecucion_detalle_supervisor(p_ejecucion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo_id uuid;
  v_total       integer;
  v_completados integer;
  v_ejecucion   jsonb;
  v_puntos      jsonb;
begin
  -- 1. Sesión.
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  -- 2. Localizar la ejecución solo para conocer su objetivo y poder autorizar.
  --    Nada de la ejecución se expone antes de pasar el control de acceso.
  select e.objetivo_id, e.puntos_total
    into v_objetivo_id, v_total
  from public.ronda_ejecuciones e
  where e.id = p_ejecucion_id;

  if not found then
    return jsonb_build_object('contexto', 'no_encontrada');
  end if;

  -- 3. Autorización: admin, o supervisor con la zona del objetivo asignada.
  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  -- 4. Progreso (puntos resueltos sobre el total congelado en la ejecución).
  select count(*)
    into v_completados
  from public.ronda_ejecucion_puntos ep
  where ep.ronda_ejecucion_id = p_ejecucion_id
    and ep.estado <> 'pendiente';

  -- 5. Cabecera de la ejecución (guardia, puesto, ronda, cierre administrativo).
  select jsonb_build_object(
    'id',                      e.id,
    'estado',                  e.estado,
    'resultado',               e.resultado,
    'iniciada_at',             e.iniciada_at,
    'finalizada_at',           e.finalizada_at,
    'fecha_operativa',         e.fecha_operativa,
    'iniciada_fuera_horario',  e.iniciada_fuera_horario,
    'puntos_total',            e.puntos_total,
    'puntos_completados',      v_completados,
    'porcentaje',              case when e.puntos_total = 0 then 0
                                    else round(v_completados * 100.0 / e.puntos_total)
                               end,
    'ronda_base_id',           e.ronda_base_id,
    'ronda_nombre',            e.snap_ronda_nombre,
    'snap_intervalo_minutos',  e.snap_intervalo_minutos,
    'snap_hora_inicio',        e.snap_hora_inicio,
    'objetivo_id',             e.objetivo_id,
    'objetivo_nombre',         o.nombre,
    'puesto_id',               e.puesto_id,
    'puesto_nombre',           pu.nombre,
    'guardia_id',              e.guardia_id,
    'guardia_nombre',          g.apellido || ', ' || g.nombre,
    -- Cierre administrativo: cerrada_por IS NOT NULL lo distingue de una ronda
    -- que el vigilador terminó con puntos incumplidos (mismo estado/resultado).
    'cerrada_por',             e.cerrada_por,
    'cerrada_por_nombre',      case when e.cerrada_por is null then null
                                    else cp.apellido || ', ' || cp.nombre end,
    'cerrada_at',              e.cerrada_at,
    'cerrada_motivo',          e.cerrada_motivo,
    'es_cierre_administrativo',(e.cerrada_por is not null)
  )
  into v_ejecucion
  from public.ronda_ejecuciones e
  join public.objetivos o  on o.id  = e.objetivo_id
  join public.puestos   pu on pu.id = e.puesto_id
  join public.usuarios  g  on g.id  = e.guardia_id
  left join public.usuarios cp on cp.id = e.cerrada_por
  where e.id = p_ejecucion_id;

  -- 6. Puntos: definición congelada (snap_*), GPS real capturado, veredictos,
  --    novedad/comentario y referencias de evidencia (sin firmar).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ejecucion_punto_id',  ep.id,
        'ronda_punto_id',      ep.ronda_punto_id,
        'orden',               ep.orden,
        'nombre',              ep.snap_nombre,
        'estado',              ep.estado,
        'registrado_at',       ep.registrado_at,
        'comentario',          ep.comentario,
        'hay_novedad',         ep.hay_novedad,
        -- Reglas congeladas al iniciar la ronda.
        'requiere_foto',       ep.snap_foto_requerida,
        'politica_foto',       ep.snap_politica_foto,
        'requiere_gps',        ep.snap_gps_requerido,
        'config_latitud',      ep.snap_latitud,
        'config_longitud',     ep.snap_longitud,
        'config_radio_metros', ep.snap_radio_metros,
        -- GPS real capturado por el vigilador.
        'latitud',             ep.latitud,
        'longitud',            ep.longitud,
        'precision_metros',    ep.precision_metros,
        'distancia_metros',    ep.distancia_metros,
        'gps_ok',              ep.gps_ok,
        'dentro_radio',        ep.dentro_radio,
        'foto_ok',             ep.foto_ok,
        -- Referencias de evidencia (proceso_id = id del punto de ejecución).
        'evidencias',          coalesce(ev.evidencias, jsonb_build_array())
      )
      order by ep.orden
    ),
    jsonb_build_array()
  )
  into v_puntos
  from public.ronda_ejecucion_puntos ep
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'id',             x.id,
               'tipo_evidencia', x.tipo_evidencia,
               'bucket',         x.bucket,
               'storage_path',   x.storage_path,
               'created_at',     x.created_at
             )
             order by x.created_at
           ) as evidencias
    from public.evidencias x
    where x.proceso_tipo = 'ronda'
      and x.proceso_id   = ep.id
  ) ev on true
  where ep.ronda_ejecucion_id = p_ejecucion_id;

  return jsonb_build_object(
    'contexto',  'ok',
    'ejecucion', v_ejecucion,
    'puntos',    v_puntos
  );
end;
$$;

revoke all on function public.rondas_ejecucion_detalle_supervisor(uuid) from public;
revoke all on function public.rondas_ejecucion_detalle_supervisor(uuid) from anon;
grant execute on function public.rondas_ejecucion_detalle_supervisor(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
