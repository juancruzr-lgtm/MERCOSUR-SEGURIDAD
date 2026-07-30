-- ============================================================================
-- RONDAS · Historial completo — una fila por ronda PROGRAMADA
-- ============================================================================
--
-- `listar_ejecuciones_objetivo()` responde "qué se ejecutó": parte de
-- `ronda_ejecuciones` y filtra `estado='finalizada'`. Una ronda que nadie inició
-- no tiene fila ahí, así que era invisible. Esta RPC responde la otra pregunta,
-- que es la que necesita el supervisor: "qué había que hacer, y qué pasó con
-- cada una".
--
-- INDEPENDENCIA DE LAS ALERTAS  (requisito explícito)
--
-- Qué filas existen y en qué estado están se deriva EXCLUSIVAMENTE de la
-- programación (`rondas_ventanas_programadas`) y de la ejecución
-- (`ronda_ejecuciones`). `ronda_alertas` NO participa de esa derivación.
-- Si mañana se vaciara `ronda_alertas` por completo, esta RPC devolvería
-- exactamente las mismas filas con exactamente los mismos estados.
--
-- Los campos del bloque `alerta_*` son un anexo informativo, siempre nullable,
-- que no condiciona nada. Están porque la suspensión declarada por el vigilador
-- y las intervenciones del supervisor hoy solo se persisten en `ronda_alertas`:
-- se muestran como anotación sobre la fila, no como su estado.
--
-- ESTADOS  (derivados de programación + ejecución, sin leer alertas)
--
--   pendiente    — sin ejecución y todavía dentro del plazo (no es incumplimiento)
--   no_iniciada  — sin ejecución y vencida
--   en_curso     — ejecución abierta
--   completada   — ejecución finalizada con resultado 'completa'
--   incompleta   — ejecución finalizada con resultado 'incompleta'
--
-- Banderas independientes, también sin leer alertas:
--   inicio_tardio             — la ejecución arrancó después del vencimiento.
--                               Una ronda puede estar 'completada' y ser tardía:
--                               se cumplió, pero fuera de la ventana exigida.
--   es_cierre_administrativo  — `ronda_ejecuciones.cerrada_por` no nulo, es decir
--                               la cerró un supervisor y no el vigilador.
--
-- El matching de ejecución a ventana usa el MISMO criterio que el evaluador de
-- alertas ([ventana_inicio, match_fin), estados en_curso/finalizada), porque
-- ambos derivan de `rondas_ventanas_programadas`. Historial y alertas no pueden
-- contradecirse.
--
-- Alcance: `listar_ejecuciones_objetivo()` NO se toca — la sigue usando la
-- sección Mapa. Esta RPC se agrega al lado.
--
-- Seguridad: SECURITY DEFINER con search_path fijo; identidad desde auth.uid();
-- autorización por `puede_administrar_rondas_objetivo(p_objetivo_id)` ANTES de
-- exponer datos; solo lectura. Contextos: 'ok' | 'sin_usuario' |
-- 'rango_invalido' | 'sin_permiso'.

begin;

create or replace function public.listar_rondas_programadas_objetivo(
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
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'rondas', jsonb_build_array());
  end if;

  if p_objetivo_id is null or p_desde is null or p_hasta is null or p_desde > p_hasta then
    return jsonb_build_object('contexto', 'rango_invalido', 'rondas', jsonb_build_array());
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'rondas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'rondas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          -- Identidad de la OBLIGACIÓN (existe haya o no ejecución).
          'ronda_base_id',   v.ronda_base_id,
          'ronda_nombre',    rb.nombre,
          'puesto_id',       v.puesto_id,
          'puesto_nombre',   pu.nombre,
          'turno_id',        v.turno_id,
          'guardia_id',      v.guardia_id,
          'guardia_nombre',  g.apellido || ', ' || g.nombre,
          'ventana_inicio',  v.ventana_inicio,
          'ventana_fin',     v.ventana_fin,
          'vencimiento_at',  v.vencimiento_at,

          -- Estado derivado de programación + ejecución. Sin alertas.
          'estado',
            case
              when e.id is null and now() < v.vencimiento_at then 'pendiente'
              when e.id is null                              then 'no_iniciada'
              when e.estado = 'en_curso'                     then 'en_curso'
              when e.resultado = 'completa'                  then 'completada'
              else                                                'incompleta'
            end,
          'inicio_tardio',
            (e.id is not null and e.iniciada_at >= v.vencimiento_at),

          -- Ejecución asociada (null si nunca se inició).
          'ejecucion_id',       e.id,
          'iniciada_at',        e.iniciada_at,
          'finalizada_at',      e.finalizada_at,
          'resultado',          e.resultado,
          'puntos_total',       e.puntos_total,
          'puntos_cumplidos',   coalesce(cnt.cumplidos,   0),
          'puntos_incumplidos', coalesce(cnt.incumplidos, 0),
          'puntos_omitidos',    coalesce(cnt.omitidos,    0),
          'cerrada_por',        e.cerrada_por,
          'cerrada_at',         e.cerrada_at,
          'cerrada_motivo',     e.cerrada_motivo,
          'es_cierre_administrativo', (e.cerrada_por is not null),

          -- ── Anexo informativo. NO deriva ni condiciona el estado de arriba. ──
          'alerta_id',              al.id,
          'alerta_tipo',            al.tipo,
          'alerta_estado',          al.estado,
          'alerta_suspendida',      (al.tipo = 'suspendida'),
          'alerta_motivo_vigilador',al.motivo_vigilador,
          'alerta_accion',          al.accion,
          'alerta_comentario',      al.comentario,
          'alerta_resuelta_por_nombre',
            case when al.resuelta_por is null then null
                 else rp.apellido || ', ' || rp.nombre end,
          'alerta_resuelta_at',     al.resuelta_at,
          'alerta_intervenciones',  coalesce(iv.total, 0)
        )
        order by v.ventana_inicio desc
      )
      from public.rondas_ventanas_programadas(p_objetivo_id, p_desde, p_hasta) v
      join public.rondas_base rb on rb.id = v.ronda_base_id
      join public.puestos     pu on pu.id = v.puesto_id
      join public.usuarios     g on  g.id = v.guardia_id

      -- Ejecución de la ventana: mismo criterio que el evaluador de alertas.
      left join lateral (
        select ex.*
        from public.ronda_ejecuciones ex
        where ex.ronda_base_id = v.ronda_base_id
          and ex.turno_id      = v.turno_id
          and ex.estado in ('en_curso', 'finalizada')
          and ex.iniciada_at  >= v.ventana_inicio
          and ex.iniciada_at  <  v.match_fin
        order by ex.iniciada_at asc
        limit 1
      ) e on true

      left join lateral (
        select
          count(*) filter (where ep.estado = 'cumplido')   as cumplidos,
          count(*) filter (where ep.estado = 'incumplido') as incumplidos,
          count(*) filter (where ep.estado = 'omitido')    as omitidos
        from public.ronda_ejecucion_puntos ep
        where ep.ronda_ejecucion_id = e.id
      ) cnt on true

      -- Anexo: alerta de esta ventana, si existe. Prioriza la suspensión
      -- declarada por el vigilador; si no, la de la ventana exacta.
      left join lateral (
        select a.*
        from public.ronda_alertas a
        where a.ronda_base_id = v.ronda_base_id
          and a.turno_id      = v.turno_id
          and (a.tipo = 'suspendida' or a.ventana_inicio = v.ventana_inicio)
        order by (a.tipo = 'suspendida') desc, a.detectada_at desc
        limit 1
      ) al on true

      left join public.usuarios rp on rp.id = al.resuelta_por
      left join lateral (
        select count(*) as total
        from public.ronda_alerta_intervenciones i
        where i.ronda_alerta_id = al.id
      ) iv on true
    ), jsonb_build_array())
  );
end;
$$;

comment on function public.listar_rondas_programadas_objetivo(uuid, date, date) is
  'Historial de rondas PROGRAMADAS de un objetivo: una fila por ventana, exista '
  'o no ejecución. El estado se deriva de programación + ejecución; los campos '
  'alerta_* son anexo informativo y no condicionan filas ni estados.';

revoke all on function public.listar_rondas_programadas_objetivo(uuid, date, date) from public;
revoke all on function public.listar_rondas_programadas_objetivo(uuid, date, date) from anon;
grant execute on function public.listar_rondas_programadas_objetivo(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
