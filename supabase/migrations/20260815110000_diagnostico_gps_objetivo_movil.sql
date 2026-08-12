-- ============================================================================
-- OBJETIVOS · El diagnóstico respeta la vigencia en los objetivos móviles
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- El diagnóstico toma 90 días de fichajes y saca una mediana. Para un objetivo
-- que se mudó en el medio, esa mediana no corresponde a ningún lugar real: es
-- el punto intermedio entre dos ubicaciones que ambas fueron correctas. Con
-- suerte cae en 'datos_anomalos' por dispersión; con mala suerte recomienda
-- recentrar sobre la nada.
--
-- CAMBIO
--
--   objetivo FIJO   → la ventana sigue siendo los últimos N días. Si los
--                     fichajes caen lejos, la ubicación está mal cargada, que
--                     es exactamente lo que el diagnóstico busca detectar.
--
--   objetivo MÓVIL  → la ventana empieza en `vigente_desde` de su ubicación
--                     actual. Los fichajes de ubicaciones anteriores no son
--                     errores de GPS: son de otro lugar, y mezclarlos produce
--                     una recomendación falsa.
--
-- Si un móvil recién mudado todavía no juntó evidencia, el diagnóstico dice
-- 'sin_datos'. Eso no es una falla: es la respuesta correcta.
--
-- El resto de la función no cambia: mismos mínimos de evidencia (8 marcaciones,
-- 2 guardias, 3 días), mismas protecciones contra agrandar el radio, mismos
-- umbrales de dispersión y confianza.
--
-- QUÉ NO TOCA
--   * Ninguna tabla. Es un reemplazo de función.
--   * La evidencia histórica, que no se recalcula nunca.
-- ============================================================================

begin;

create or replace function public.diagnosticar_gps_objetivo(
  p_objetivo_id uuid,
  p_dias integer default 90
)
returns public.objetivo_diagnosticos_gps
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_precision_max    constant double precision := 100.0;
  v_min_marcaciones  constant integer          := 8;
  v_min_guardias     constant integer          := 2;
  v_min_dias         constant integer          := 3;
  v_disperso_p90     constant double precision := 250.0;
  v_lejos_metros     constant double precision := 150.0;
  v_margen_radio     constant double precision := 25.0;
  v_radio_min        constant integer          := 50;
  v_radio_max        constant integer          := 500;
  v_umbral_radio     constant integer          := 25;
  v_reuso_horas      constant integer          := 24;

  v_objetivo   public.objetivos;
  v_dias       integer;
  v_desde      date;
  v_desde_vig  timestamptz;

  v_n          integer;
  v_guardias   integer;
  v_dias_dist  integer;
  v_lat_sug    double precision;
  v_lon_sug    double precision;
  v_p50        double precision;
  v_p90        double precision;
  v_max        double precision;
  v_radio_sug  integer;
  v_desplaz    double precision;
  v_reco       text;
  v_confianza  text;
  v_firma      text;

  v_previo     public.objetivo_diagnosticos_gps;
  v_fila       public.objetivo_diagnosticos_gps;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select o.* into v_objetivo
  from public.objetivos o
  where o.id = p_objetivo_id;

  if not found then
    raise exception 'Objetivo no encontrado';
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    raise exception 'No autorizado para diagnosticar este objetivo';
  end if;

  v_dias  := least(greatest(coalesce(p_dias, 90), 7), 365);
  v_desde := (now() - make_interval(days => v_dias))::date;

  -- En un objetivo MÓVIL la ventana no puede cruzar la mudanza: se recorta al
  -- inicio de la vigencia actual. En uno fijo no se toca.
  if v_objetivo.tipo_ubicacion = 'movil' then
    select u.vigente_desde into v_desde_vig
    from public.objetivo_ubicaciones u
    where u.objetivo_id = p_objetivo_id
      and u.vigente_hasta is null
    limit 1;

    if v_desde_vig is not null and v_desde_vig::date > v_desde then
      v_desde := v_desde_vig::date;
      -- Se informa la ventana realmente usada, no la pedida.
      v_dias := greatest(1, (current_date - v_desde));
    end if;
  end if;

  with marcaciones as (
    select r.guardia_id, t.fecha, m.lat, m.lng
    from public.registros_asistencia r
    join public.turnos t on t.id = r.turno_id
    cross join lateral (
      values
        (coalesce(r.latitud_ingreso, r.lat_entrada),
         coalesce(r.longitud_ingreso, r.lng_entrada),
         r.precision_ingreso),
        (coalesce(r.latitud_egreso, r.lat_salida),
         coalesce(r.longitud_egreso, r.lng_salida),
         r.precision_egreso)
    ) as m(lat, lng, precision)
    where t.objetivo_id = p_objetivo_id
      and t.fecha >= v_desde
      and r.tipo_registro = 'fichaje_gps'
      and m.lat is not null
      and m.lng is not null
      and (m.precision is null or m.precision <= v_precision_max)
  )
  select
    count(*)::integer,
    count(distinct guardia_id)::integer,
    count(distinct fecha)::integer,
    percentile_cont(0.5) within group (order by lat),
    percentile_cont(0.5) within group (order by lng)
  into v_n, v_guardias, v_dias_dist, v_lat_sug, v_lon_sug
  from marcaciones;

  v_n         := coalesce(v_n, 0);
  v_guardias  := coalesce(v_guardias, 0);
  v_dias_dist := coalesce(v_dias_dist, 0);

  if v_n < v_min_marcaciones
     or v_guardias < v_min_guardias
     or v_dias_dist < v_min_dias then
    v_lat_sug := null; v_lon_sug := null; v_radio_sug := null;
    v_reco := 'sin_datos';
    v_confianza := 'sin_datos';
  else
    with marcaciones as (
      select m.lat, m.lng
      from public.registros_asistencia r
      join public.turnos t on t.id = r.turno_id
      cross join lateral (
        values
          (coalesce(r.latitud_ingreso, r.lat_entrada),
           coalesce(r.longitud_ingreso, r.lng_entrada),
           r.precision_ingreso),
          (coalesce(r.latitud_egreso, r.lat_salida),
           coalesce(r.longitud_egreso, r.lng_salida),
           r.precision_egreso)
      ) as m(lat, lng, precision)
      where t.objetivo_id = p_objetivo_id
        and t.fecha >= v_desde
        and r.tipo_registro = 'fichaje_gps'
        and m.lat is not null
        and m.lng is not null
        and (m.precision is null or m.precision <= v_precision_max)
    )
    select
      percentile_cont(0.5) within group (order by d.dist),
      percentile_cont(0.9) within group (order by d.dist),
      max(d.dist)
    into v_p50, v_p90, v_max
    from (
      select public.rondas_distancia_metros(v_lat_sug, v_lon_sug, lat, lng) as dist
      from marcaciones
    ) d;

    if v_objetivo.lat is null or v_objetivo.lng is null then
      v_desplaz := null;
    else
      v_desplaz := public.rondas_distancia_metros(
        v_objetivo.lat::double precision, v_objetivo.lng::double precision,
        v_lat_sug, v_lon_sug
      );
    end if;

    if v_p90 > v_disperso_p90 then
      v_lat_sug := null; v_lon_sug := null; v_radio_sug := null;
      v_reco := 'datos_anomalos';
      v_confianza := 'baja';
    else
      v_radio_sug := least(
        v_radio_max,
        greatest(v_radio_min, (ceil((v_p90 + v_margen_radio) / 10.0) * 10)::integer)
      );

      v_confianza := case
        when v_n >= 20 and v_guardias >= 4 and v_dias_dist >= 10 and v_p90 <= 100 then 'alta'
        when v_p90 <= v_disperso_p90 then 'media'
        else 'baja'
      end;

      v_reco := case
        when v_desplaz is null then 'recentrar_y_radio'
        when v_desplaz > v_lejos_metros then
          case when v_objetivo.radio_metros is null
                    or abs(v_radio_sug - v_objetivo.radio_metros) > v_umbral_radio
               then 'recentrar_y_radio' else 'recentrar' end
        when v_desplaz > v_margen_radio then 'recentrar'
        when v_objetivo.radio_metros is null
             or abs(v_radio_sug - v_objetivo.radio_metros) > v_umbral_radio
          then 'ajustar_radio'
        else 'sin_cambios'
      end;
    end if;
  end if;

  v_firma := 'dgo1:' || md5(concat_ws('|',
    p_objetivo_id::text, v_reco, v_confianza,
    v_n::text, v_guardias::text, v_dias_dist::text,
    coalesce(round(v_lat_sug::numeric, 7)::text, ''),
    coalesce(round(v_lon_sug::numeric, 7)::text, ''),
    coalesce(v_radio_sug::text, '')
  ));

  select d.* into v_previo
  from public.objetivo_diagnosticos_gps d
  where d.objetivo_id = p_objetivo_id
    and d.firma       = v_firma
    and d.created_at >= now() - make_interval(hours => v_reuso_horas)
  order by d.created_at desc
  limit 1;

  if found then
    return v_previo;
  end if;

  insert into public.objetivo_diagnosticos_gps (
    objetivo_id, firma, dias_analizados,
    marcaciones, guardias_distintos, dias_distintos,
    latitud_actual, longitud_actual, radio_actual,
    latitud_sugerida, longitud_sugerida, radio_sugerido,
    distancia_p50, distancia_p90, distancia_max, desplazamiento_metros,
    recomendacion, confianza, detalle, generado_por
  ) values (
    p_objetivo_id, v_firma, v_dias,
    v_n, v_guardias, v_dias_dist,
    v_objetivo.lat::double precision, v_objetivo.lng::double precision, v_objetivo.radio_metros,
    v_lat_sug, v_lon_sug, v_radio_sug,
    v_p50, v_p90, v_max, v_desplaz,
    v_reco, v_confianza,
    jsonb_build_object(
      'metodo',            'mediana_p90_fichajes',
      'tipo_ubicacion',    v_objetivo.tipo_ubicacion,
      'ventana_desde',     v_desde,
      'acotado_a_vigencia', v_objetivo.tipo_ubicacion = 'movil' and v_desde_vig is not null,
      'precision_max_m',   v_precision_max,
      'min_marcaciones',   v_min_marcaciones,
      'min_guardias',      v_min_guardias,
      'min_dias',          v_min_dias,
      'disperso_p90_m',    v_disperso_p90,
      'lejos_m',           v_lejos_metros,
      'margen_radio_m',    v_margen_radio,
      'radio_min_m',       v_radio_min,
      'radio_max_m',       v_radio_max,
      'umbral_radio_m',    v_umbral_radio,
      'solo_fichaje_gps',  true
    ),
    (select u.id from public.usuarios u
      where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1)
  )
  returning * into v_fila;

  return v_fila;
end;
$$;

revoke all on function public.diagnosticar_gps_objetivo(uuid, integer) from public;
revoke all on function public.diagnosticar_gps_objetivo(uuid, integer) from anon;
grant execute on function public.diagnosticar_gps_objetivo(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
