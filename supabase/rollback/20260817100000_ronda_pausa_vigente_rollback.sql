-- ROLLBACK de 20260817100000_ronda_pausa_vigente.sql
--
-- Vuelve listar_rondas_programadas_objetivo a la version de 20260802200000:
-- el estado 'pausada' se deriva de que exista CUALQUIER pausa que cubra la
-- ventana, aunque ya se haya reanudado, y el JSON deja de traer `pausa_vigente`.
--
-- ANTES DE EJECUTAR: hay que volver tambien el frontend. lib/rondas.ts lee
-- `pausa_vigente` para el estado tecnico; sin ese campo queda `undefined`, que
-- es falsy, y NINGUNA ronda se mostraria como pausada — ni siquiera las que
-- estan pausadas de verdad. Es peor que el sintoma original.
--
-- No borra ni modifica ningun dato: ronda_pausas, ejecuciones y alertas quedan
-- exactamente igual. Esto solo cambia como se deriva un estado de lectura.
--
-- La forma mas simple de revertir es reejecutar el bloque de
-- 20260802200000_ronda_pausas.sql que define esta funcion (lineas 482 a 641).
-- Se reproduce aca completo para no depender de ese archivo.

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

          'estado',
            case
              when e.id is not null and e.estado = 'en_curso'    then 'en_curso'
              when e.id is not null and e.resultado = 'completa' then 'completada'
              when e.id is not null                              then 'incompleta'
              when pa.id is not null                             then 'pausada'
              when now() < v.vencimiento_at                      then 'pendiente'
              else                                                    'no_iniciada'
            end,
          'inicio_tardio',
            (e.id is not null and e.iniciada_at >= v.vencimiento_at),

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
          'alerta_intervenciones',  coalesce(iv.total, 0),

          -- Anexo de pausa. NO condiciona estados previos; solo informa.
          'pausada',              (pa.id is not null),
          'pausa_id',             pa.id,
          'pausa_motivo',         pa.motivo,
          'pausa_desde',          pa.pausada_at,
          'pausa_hasta',          pa.hasta_at,
          'pausada_por_nombre',   pa.pausada_por_nombre
        )
        order by v.ventana_inicio desc
      )
      from public.rondas_ventanas_programadas(p_objetivo_id, p_desde, p_hasta) v
      join public.rondas_base rb on rb.id = v.ronda_base_id
      join public.puestos     pu on pu.id = v.puesto_id
      join public.usuarios     g on  g.id = v.guardia_id

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

      -- Pausa que cubre esta ventana. Mismo criterio temporal que el evaluador.
      left join lateral (
        select px.*,
               upx.apellido || ', ' || upx.nombre as pausada_por_nombre
        from public.ronda_pausas px
        join public.usuarios upx on upx.id = px.pausada_por
        where px.ronda_base_id = v.ronda_base_id
          and px.pausada_at <= v.ventana_inicio
          and (
            (px.activa = true and px.hasta_at is null)
            or (px.activa = true and px.hasta_at is not null and v.ventana_inicio < px.hasta_at)
            or (px.activa = false and px.reactivada_at is not null and v.ventana_inicio < px.reactivada_at)
          )
        order by px.pausada_at desc
        limit 1
      ) pa on true
    ), jsonb_build_array())
  );
end;
$$;

comment on function public.listar_rondas_programadas_objetivo(uuid, date, date) is
  'Historial de rondas PROGRAMADAS de un objetivo: una fila por ventana, exista '
  'o no ejecución. El estado se deriva de programación + ejecución; los campos '
  'alerta_* y pausa_* son anexo informativo y no condicionan filas ni estados.';

revoke all on function public.listar_rondas_programadas_objetivo(uuid, date, date) from public;
revoke all on function public.listar_rondas_programadas_objetivo(uuid, date, date) from anon;
grant execute on function public.listar_rondas_programadas_objetivo(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
