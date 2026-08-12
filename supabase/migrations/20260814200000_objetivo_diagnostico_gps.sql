-- ============================================================================
-- OBJETIVOS · Diagnóstico GPS a partir de los fichajes reales
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- La ubicación de un objetivo la fija quien estuvo parado ahí la primera vez.
-- Si quedó mal, el síntoma aparece solo: fichajes de guardias distintos, en
-- días distintos, cayendo todos juntos en otro lado. Este diagnóstico lee ese
-- historial y dice dónde está realmente la puerta.
--
-- ES UNA LECTURA CON RESULTADO PERSISTIDO. No modifica el objetivo. Aplicar la
-- sugerencia es una decisión de una persona, y queda auditada en
-- objetivos_auditoria con origen 'diagnostico_gps' y esta firma.
--
-- MUESTRA
--   * registros_asistencia con tipo_registro = 'fichaje_gps' (los manuales, las
--     ausencias y los reemplazos no son capturas GPS reales);
--   * ingresos Y egresos, cada uno como una marcación independiente;
--   * coordenada leída con coalesce de las DOS nomenclaturas que conviven en la
--     tabla: latitud_ingreso/longitud_ingreso (actual) y lat_entrada/lng_entrada
--     (esquema original). Leer una sola devuelve null en media tabla;
--   * precisión declarada <= 100 m, o sin precisión declarada;
--   * ventana de N días sobre la fecha del turno.
--
-- POR QUÉ NO ALCANZA CON CONTAR MARCACIONES
--
-- Un solo vigilador que ficha siempre desde el mismo lugar equivocado produce
-- cincuenta marcaciones consistentes y una recomendación falsa. Por eso la
-- evidencia se mide en tres dimensiones y las tres tienen mínimo:
--
--   marcaciones >= 8 · guardias distintos >= 2 · días distintos >= 3
--
-- Por debajo de cualquiera de esos tres: 'sin_datos'. No se propone nada.
--
-- PROTECCIÓN CONTRA "AGRANDAR EL RADIO HASTA QUE ENTRE"
--
-- Un grupo de fichajes lejos del objetivo NO puede resolverse estirando el
-- radio: eso convertiría en válido cualquier fichaje a kilómetros. La regla:
--
--   * si las marcaciones están DISPERSAS (p90 > 250 m del centro), el conjunto
--     no describe ningún lugar: 'datos_anomalos', no se ofrece aplicar;
--   * si están CONCENTRADAS pero lejos (> 150 m), la recomendación es
--     recentrar, nunca sólo agrandar;
--   * el radio sugerido está acotado a 500 m como techo duro.
--
-- CONFIANZA
--   alta   >= 20 marcaciones, >= 4 guardias, >= 10 días y p90 <= 100 m
--   media  cumple los mínimos y p90 <= 250 m
--   baja   cumple los mínimos pero la nube es ancha
-- Sólo alta y media habilitan Aplicar.
--
-- QUÉ NO TOCA
--   * Ni una fila de registros_asistencia. Es evidencia.
--   * Ninguna lógica de fichaje: no cambia cómo se calcula dentro/fuera.
--   * Ningún objetivo.
-- ============================================================================

begin;

create table public.objetivo_diagnosticos_gps (
  id                    uuid primary key default gen_random_uuid(),
  objetivo_id           uuid not null references public.objetivos(id) on delete cascade,

  firma                 text not null,

  dias_analizados       integer not null,
  marcaciones           integer not null,
  guardias_distintos    integer not null,
  dias_distintos        integer not null,

  latitud_actual        double precision,
  longitud_actual       double precision,
  radio_actual          integer,

  latitud_sugerida      double precision,
  longitud_sugerida     double precision,
  radio_sugerido        integer,

  distancia_p50         double precision,
  distancia_p90         double precision,
  distancia_max         double precision,
  desplazamiento_metros double precision,

  recomendacion         text not null,
  confianza             text not null,
  detalle               jsonb not null default '{}'::jsonb,

  generado_por          uuid references public.usuarios(id),
  created_at            timestamptz not null default now(),

  constraint objetivo_diagnosticos_gps_recomendacion_valida
    check (recomendacion in (
      'sin_datos', 'datos_anomalos', 'sin_cambios',
      'ajustar_radio', 'recentrar', 'recentrar_y_radio'
    )),

  constraint objetivo_diagnosticos_gps_confianza_valida
    check (confianza in ('sin_datos', 'baja', 'media', 'alta')),

  constraint objetivo_diagnosticos_gps_firma_no_vacia
    check (length(btrim(firma)) > 0),

  constraint objetivo_diagnosticos_gps_conteos_validos
    check (marcaciones >= 0 and guardias_distintos >= 0 and dias_distintos >= 0),

  -- Una recomendación accionable siempre trae los tres valores sugeridos.
  constraint objetivo_diagnosticos_gps_sugerencia_coherente
    check (
      (recomendacion in ('sin_datos', 'datos_anomalos')
        and latitud_sugerida is null
        and longitud_sugerida is null
        and radio_sugerido is null)
      or
      (recomendacion not in ('sin_datos', 'datos_anomalos')
        and latitud_sugerida is not null
        and longitud_sugerida is not null
        and radio_sugerido is not null)
    ),

  -- Techo duro: ninguna recomendación puede pedir un radio desmedido.
  constraint objetivo_diagnosticos_gps_radio_acotado
    check (radio_sugerido is null or radio_sugerido between 50 and 500)
);

comment on table public.objetivo_diagnosticos_gps is
  'Diagnósticos de ubicación de objetivos calculados sobre los fichajes reales. '
  'Sólo lectura de evidencia: no modifica el objetivo. La firma es el vínculo '
  'con objetivos_auditoria.firma cuando la sugerencia se aplica.';

create index idx_objetivo_diagnosticos_gps_objetivo
  on public.objetivo_diagnosticos_gps (objetivo_id, created_at desc);

create index idx_objetivo_diagnosticos_gps_firma
  on public.objetivo_diagnosticos_gps (firma);

alter table public.objetivo_diagnosticos_gps enable row level security;

revoke all on table public.objetivo_diagnosticos_gps from public;
revoke all on table public.objetivo_diagnosticos_gps from anon;
revoke all on table public.objetivo_diagnosticos_gps from authenticated;

grant select on table public.objetivo_diagnosticos_gps to authenticated;

create policy "Admin supervisor lee diagnosticos gps de objetivos de su alcance"
on public.objetivo_diagnosticos_gps
for select
to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

-- ── RPC de diagnóstico ──────────────────────────────────────────────────────

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
  -- Umbrales. Si mañana se discuten, se discuten acá.
  v_precision_max    constant double precision := 100.0;
  v_min_marcaciones  constant integer          := 8;
  v_min_guardias     constant integer          := 2;
  v_min_dias         constant integer          := 3;
  v_disperso_p90     constant double precision := 250.0;  -- más que esto: nube sin forma
  v_lejos_metros     constant double precision := 150.0;  -- más que esto: recentrar, no agrandar
  v_margen_radio     constant double precision := 25.0;
  v_radio_min        constant integer          := 50;
  v_radio_max        constant integer          := 500;
  v_umbral_radio     constant integer          := 25;
  v_reuso_horas      constant integer          := 24;

  v_objetivo   public.objetivos;
  v_dias       integer;
  v_desde      date;

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

  -- Centro sugerido y evidencia, sobre ingresos y egresos por igual.
  with marcaciones as (
    select r.guardia_id, t.fecha, m.lat, m.lng
    from public.registros_asistencia r
    join public.turnos t on t.id = r.turno_id
    cross join lateral (
      values
        -- coalesce de las dos nomenclaturas: la actual y la del esquema original
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
    -- Evidencia insuficiente en alguna de las tres dimensiones.
    v_lat_sug := null; v_lon_sug := null; v_radio_sug := null;
    v_reco := 'sin_datos';
    v_confianza := 'sin_datos';
  else
    -- Dispersión respecto del centro sugerido.
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
      -- Las marcaciones no describen ningún lugar: no se propone nada.
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
        -- Sin ubicación cargada: hay que ubicarlo, no agrandar nada.
        when v_desplaz is null then 'recentrar_y_radio'
        -- Concentradas pero lejos: recentrar. Nunca sólo agrandar el radio.
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

  -- Idempotencia: mismo diagnóstico dentro de 24 h no crea otra fila.
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
      'metodo',             'mediana_p90_fichajes',
      'precision_max_m',    v_precision_max,
      'min_marcaciones',    v_min_marcaciones,
      'min_guardias',       v_min_guardias,
      'min_dias',           v_min_dias,
      'disperso_p90_m',     v_disperso_p90,
      'lejos_m',            v_lejos_metros,
      'margen_radio_m',     v_margen_radio,
      'radio_min_m',        v_radio_min,
      'radio_max_m',        v_radio_max,
      'umbral_radio_m',     v_umbral_radio,
      'solo_fichaje_gps',   true
    ),
    (select u.id from public.usuarios u
      where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1)
  )
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function public.diagnosticar_gps_objetivo(uuid, integer) is
  'Diagnostica la ubicación de un objetivo contra los fichajes GPS reales. No '
  'modifica el objetivo: devuelve y persiste una sugerencia firmada, con la '
  'evidencia usada (marcaciones, guardias y días distintos) y su confianza.';

revoke all on function public.diagnosticar_gps_objetivo(uuid, integer) from public;
revoke all on function public.diagnosticar_gps_objetivo(uuid, integer) from anon;
grant execute on function public.diagnosticar_gps_objetivo(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
