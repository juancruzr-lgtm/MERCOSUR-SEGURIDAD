-- ============================================================================
-- ROLLBACK · 20260802200000_ronda_pausas
-- ============================================================================
-- Restaura evaluar_ronda_alertas y listar_rondas_programadas_objetivo a sus
-- versiones anteriores (20260801140000 y 20260801160000 respectivamente),
-- elimina las 3 RPCs nuevas y la tabla ronda_pausas.

begin;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Eliminar RPCs nuevas                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

drop function if exists public.pausar_ronda(uuid, text, timestamptz);
drop function if exists public.reanudar_ronda(uuid, text);
drop function if exists public.listar_rondas_pausadas(uuid, boolean);

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Restaurar evaluar_ronda_alertas (versión 20260801140000)                 ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create or replace function public.evaluar_ronda_alertas()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tz            constant text := 'America/Argentina/Buenos_Aires';
  v_ahora         timestamptz := now();
  v_hoy           date := (now() at time zone v_tz)::date;
  v_lookback_dias int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_lookback_dias'), 2);

  r           record;
  v_ejec      record;
  v_tipo      text;
  v_ejec_id   uuid;
  v_afectadas int := 0;
begin
  for r in
    select *
    from public.rondas_ventanas_programadas(
      null,
      v_hoy - v_lookback_dias,
      v_hoy
    )
  loop
    if v_ahora < r.vencimiento_at then
      continue;
    end if;

    select e.id, e.iniciada_at, e.finalizada_at, e.estado
      into v_ejec
      from public.ronda_ejecuciones e
     where e.ronda_base_id = r.ronda_base_id
       and e.turno_id      = r.turno_id
       and e.estado in ('en_curso', 'finalizada')
       and e.iniciada_at >= r.ventana_inicio
       and e.iniciada_at <  r.match_fin
     order by e.iniciada_at asc
     limit 1;

    if not found then
      v_tipo    := 'no_iniciada';
      v_ejec_id := null;
    elsif v_ejec.iniciada_at < r.vencimiento_at then
      if v_ejec.estado = 'en_curso'
         or (v_ejec.finalizada_at is not null and v_ejec.finalizada_at > r.vencimiento_at) then
        v_tipo    := 'no_finalizada';
        v_ejec_id := v_ejec.id;
      else
        v_tipo    := null;
      end if;
    else
      v_tipo    := 'no_iniciada';
      v_ejec_id := v_ejec.id;
    end if;

    if v_tipo = 'no_iniciada' and exists (
      select 1
        from public.ronda_alertas a
       where a.ronda_base_id = r.ronda_base_id
         and a.turno_id      = r.turno_id
         and a.tipo          = 'suspendida'
         and a.estado        = 'pendiente'
    ) then
      v_tipo := null;
    end if;

    if v_tipo is not null then
      insert into public.ronda_alertas (
        objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
        tipo, ventana_inicio, ventana_fin, vencimiento_at
      ) values (
        r.objetivo_id, r.puesto_id, r.ronda_base_id, r.turno_id, r.guardia_id, v_ejec_id,
        v_tipo, r.ventana_inicio, r.ventana_fin, r.vencimiento_at
      )
      on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do update
        set ejecucion_id = coalesce(excluded.ejecucion_id, ronda_alertas.ejecucion_id),
            updated_at   = now()
        where ronda_alertas.estado = 'pendiente';

      v_afectadas := v_afectadas + 1;
    end if;
  end loop;

  return v_afectadas;
end;
$$;

revoke all on function public.evaluar_ronda_alertas() from public;
revoke all on function public.evaluar_ronda_alertas() from anon;
revoke all on function public.evaluar_ronda_alertas() from authenticated;
grant execute on function public.evaluar_ronda_alertas() to service_role;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Restaurar listar_rondas_programadas_objetivo (versión 20260801160000)    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

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
              when e.id is null and now() < v.vencimiento_at then 'pendiente'
              when e.id is null                              then 'no_iniciada'
              when e.estado = 'en_curso'                     then 'en_curso'
              when e.resultado = 'completa'                  then 'completada'
              else                                                'incompleta'
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
          'alerta_intervenciones',  coalesce(iv.total, 0)
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

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Eliminar tabla                                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

drop table if exists public.ronda_pausas;

notify pgrst, 'reload schema';

commit;
