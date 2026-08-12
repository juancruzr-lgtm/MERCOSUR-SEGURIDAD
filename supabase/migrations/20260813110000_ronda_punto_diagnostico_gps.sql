-- ============================================================================
-- RONDAS · Diagnóstico GPS de un punto de control
-- ============================================================================
--
-- QUÉ RESUELVE
--
-- Cuando un punto acumula incumplimientos GPS, hoy no hay forma de distinguir
-- "el vigilador no llegó al punto" de "el punto está mal configurado". Los
-- datos para distinguirlo ya existen: cada visita registrada guarda la posición
-- real capturada por el teléfono en ronda_ejecucion_puntos.
--
-- Esta migración lee ese historial y produce un DIAGNÓSTICO: dónde está de
-- verdad el punto según las capturas, qué radio cubriría el 90 % de ellas, y si
-- conviene recentrar, ajustar el radio, ambas cosas o ninguna.
--
-- ES UNA LECTURA CON RESULTADO PERSISTIDO. No modifica ronda_puntos, no cambia
-- radios, no cierra alertas, no toca ejecuciones. La aplicación del cambio la
-- decide una persona desde el editor, y esa aplicación queda auditada por
-- 20260813100000_ronda_puntos_auditoria.
--
-- POR QUÉ SE PERSISTE EL DIAGNÓSTICO
--
-- Porque la auditoría guarda una `firma` y esa firma tiene que poder resolverse
-- después. Sin la tabla, dentro de seis meses una fila de auditoría diría
-- "origen = diagnostico_gps, firma = dg1:ab34…" y nadie podría reconstruir qué
-- decía ese diagnóstico ni con qué muestra se calculó.
--
-- La firma es TRAZABILIDAD, no autorización: el trigger de auditoría la registra
-- pero no la verifica contra esta tabla. Verificarla exigiría que el diagnóstico
-- fuera reproducible en el instante del "Aplicar", y la muestra puede haber
-- cambiado entre el diagnóstico y la aplicación.
--
-- MUESTRA CONSIDERADA
--   * visitas registradas (registrado_at not null) de los últimos N días,
--   * con veredicto GPS válido del servidor (gps_ok = true),
--   * con coordenadas capturadas,
--   * con precisión declarada <= 100 m (o sin precisión declarada).
--   Se necesitan al menos 5 visitas: por debajo, el diagnóstico es 'sin_datos'
--   y no propone nada. NO se filtra por dentro_radio: excluir las visitas fuera
--   de radio sesgaría el diagnóstico justo hacia la configuración que se está
--   poniendo en duda.
--
-- MÉTODO
--   Centro sugerido = mediana de latitudes y mediana de longitudes. La mediana
--   (no el promedio) porque una sola captura errática a 400 m corre el promedio
--   y no corre la mediana.
--   Radio sugerido = p90 de las distancias al centro sugerido + 10 m de margen,
--   redondeado hacia arriba a múltiplo de 5, acotado a [15, 200].
--
-- ORDEN DE APLICACIÓN
--   Esta migración es independiente y puede aplicarse sola, pero el flujo
--   "Aplicar" sólo queda completo con 20260813100000 ya aplicada.
-- ============================================================================

begin;

-- ── Diagnósticos persistidos ────────────────────────────────────────────────

create table public.ronda_punto_diagnosticos_gps (
  id                    uuid primary key default gen_random_uuid(),
  ronda_punto_id        uuid not null references public.ronda_puntos(id) on delete cascade,
  ronda_base_id         uuid not null references public.rondas_base(id) on delete restrict,

  firma                 text not null,

  dias_analizados       integer not null,
  visitas_consideradas  integer not null,

  -- Configuración vigente al momento del diagnóstico.
  radio_actual          integer,
  latitud_actual        double precision,
  longitud_actual       double precision,

  -- Propuesta. Todo null cuando la recomendación es 'sin_datos'.
  latitud_sugerida      double precision,
  longitud_sugerida     double precision,
  radio_sugerido        integer,

  distancia_p50         double precision,
  distancia_p90         double precision,
  distancia_max         double precision,
  desplazamiento_metros double precision,

  recomendacion         text not null,
  detalle               jsonb not null default '{}'::jsonb,

  generado_por          uuid references public.usuarios(id),
  created_at            timestamptz not null default now(),

  constraint ronda_punto_diagnosticos_gps_recomendacion_valida
    check (recomendacion in (
      'sin_datos', 'sin_cambios', 'ajustar_radio', 'recentrar', 'recentrar_y_radio'
    )),

  constraint ronda_punto_diagnosticos_gps_firma_no_vacia
    check (length(btrim(firma)) > 0),

  constraint ronda_punto_diagnosticos_gps_visitas_validas
    check (visitas_consideradas >= 0),

  constraint ronda_punto_diagnosticos_gps_sugerencia_coherente
    check (
      (recomendacion = 'sin_datos'
        and latitud_sugerida is null
        and longitud_sugerida is null
        and radio_sugerido is null)
      or
      (recomendacion <> 'sin_datos'
        and latitud_sugerida is not null
        and longitud_sugerida is not null
        and radio_sugerido is not null)
    ),

  constraint ronda_punto_diagnosticos_gps_radio_sugerido_valido
    check (radio_sugerido is null or radio_sugerido between 15 and 200)
);

comment on table public.ronda_punto_diagnosticos_gps is
  'Diagnósticos GPS de puntos de ronda. Sólo lectura de datos operativos: no '
  'modifica la configuración del punto. La firma es el vínculo con '
  'ronda_puntos_auditoria.firma cuando la sugerencia se aplica.';

comment on column public.ronda_punto_diagnosticos_gps.firma is
  'Huella determinística del contenido de la sugerencia (dg1:<md5>). Dos '
  'diagnósticos con la misma muestra y el mismo resultado comparten firma.';

create index idx_ronda_punto_diagnosticos_gps_punto
  on public.ronda_punto_diagnosticos_gps (ronda_punto_id, created_at desc);

create index idx_ronda_punto_diagnosticos_gps_firma
  on public.ronda_punto_diagnosticos_gps (firma);

-- ── RLS y grants ────────────────────────────────────────────────────────────
-- Igual que la auditoría: `authenticated` nace con todos los privilegios por
-- los DEFAULT PRIVILEGES de Supabase (20260725_m1bis). Hay que revocar.

alter table public.ronda_punto_diagnosticos_gps enable row level security;

revoke all on table public.ronda_punto_diagnosticos_gps from public;
revoke all on table public.ronda_punto_diagnosticos_gps from anon;
revoke all on table public.ronda_punto_diagnosticos_gps from authenticated;

grant select on table public.ronda_punto_diagnosticos_gps to authenticated;

-- Se escribe únicamente desde la RPC SECURITY DEFINER: no hay policy de INSERT.
create policy "Admin supervisor lee diagnosticos gps de su alcance"
on public.ronda_punto_diagnosticos_gps
for select
to authenticated
using (
  exists (
    select 1
    from public.rondas_base rb
    where rb.id = ronda_punto_diagnosticos_gps.ronda_base_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
);

-- ── RPC de diagnóstico ──────────────────────────────────────────────────────

create or replace function public.diagnosticar_gps_ronda_punto(
  p_ronda_punto_id uuid,
  p_dias integer default 90
)
returns public.ronda_punto_diagnosticos_gps
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  -- Umbrales centrales. Si mañana se discuten, se discuten acá.
  v_min_visitas        constant integer          := 5;
  v_precision_max      constant double precision := 100.0;
  v_margen_radio       constant double precision := 10.0;
  v_radio_min          constant integer          := 15;
  v_radio_max          constant integer          := 200;
  v_umbral_desplazar   constant double precision := 10.0;
  v_umbral_radio       constant integer          := 5;
  v_reuso_horas        constant integer          := 24;

  v_punto        public.ronda_puntos;
  v_objetivo_id  uuid;
  v_dias         integer;
  v_desde        timestamptz;

  v_n            integer;
  v_lat_sug      double precision;
  v_lon_sug      double precision;
  v_p50          double precision;
  v_p90          double precision;
  v_max          double precision;
  v_radio_sug    integer;
  v_desplaz      double precision;
  v_reco         text;
  v_firma        text;

  v_previo       public.ronda_punto_diagnosticos_gps;
  v_fila         public.ronda_punto_diagnosticos_gps;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  v_dias  := least(greatest(coalesce(p_dias, 90), 7), 365);
  v_desde := now() - make_interval(days => v_dias);

  select rp.* into v_punto
  from public.ronda_puntos rp
  where rp.id = p_ronda_punto_id;

  if not found then
    raise exception 'Punto de ronda no encontrado';
  end if;

  select rb.objetivo_id into v_objetivo_id
  from public.rondas_base rb
  where rb.id = v_punto.ronda_base_id;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    raise exception 'No autorizado para diagnosticar esta ronda';
  end if;

  -- Centro sugerido: medianas de la muestra.
  select
    count(*)::integer,
    percentile_cont(0.5) within group (order by m.latitud),
    percentile_cont(0.5) within group (order by m.longitud)
  into v_n, v_lat_sug, v_lon_sug
  from (
    select rep.latitud, rep.longitud
    from public.ronda_ejecucion_puntos rep
    where rep.ronda_punto_id  = p_ronda_punto_id
      and rep.registrado_at  is not null
      and rep.registrado_at >= v_desde
      and rep.gps_ok         is true
      and rep.latitud        is not null
      and rep.longitud       is not null
      and (rep.precision_metros is null or rep.precision_metros <= v_precision_max)
  ) m;

  if coalesce(v_n, 0) < v_min_visitas then
    v_lat_sug   := null;
    v_lon_sug   := null;
    v_radio_sug := null;
    v_reco      := 'sin_datos';
  else
    -- Dispersión de la muestra respecto del centro sugerido.
    select
      percentile_cont(0.5) within group (order by d.dist),
      percentile_cont(0.9) within group (order by d.dist),
      max(d.dist)
    into v_p50, v_p90, v_max
    from (
      select public.rondas_distancia_metros(
               v_lat_sug, v_lon_sug, rep.latitud, rep.longitud
             ) as dist
      from public.ronda_ejecucion_puntos rep
      where rep.ronda_punto_id  = p_ronda_punto_id
        and rep.registrado_at  is not null
        and rep.registrado_at >= v_desde
        and rep.gps_ok         is true
        and rep.latitud        is not null
        and rep.longitud       is not null
        and (rep.precision_metros is null or rep.precision_metros <= v_precision_max)
    ) d;

    v_radio_sug := least(
      v_radio_max,
      greatest(v_radio_min, (ceil((v_p90 + v_margen_radio) / 5.0) * 5)::integer)
    );

    if v_punto.latitud is null or v_punto.longitud is null then
      v_desplaz := null;
      v_reco    := 'recentrar_y_radio';
    else
      v_desplaz := public.rondas_distancia_metros(
        v_punto.latitud, v_punto.longitud, v_lat_sug, v_lon_sug
      );

      v_reco := case
        when v_desplaz > v_umbral_desplazar
             and (v_punto.radio_metros is null
                  or abs(v_radio_sug - v_punto.radio_metros) > v_umbral_radio)
          then 'recentrar_y_radio'
        when v_desplaz > v_umbral_desplazar
          then 'recentrar'
        when v_punto.radio_metros is null
             or abs(v_radio_sug - v_punto.radio_metros) > v_umbral_radio
          then 'ajustar_radio'
        else 'sin_cambios'
      end;
    end if;
  end if;

  -- Firma determinística del contenido de la sugerencia.
  v_firma := 'dg1:' || md5(concat_ws('|',
    p_ronda_punto_id::text,
    v_reco,
    v_n::text,
    coalesce(round(v_lat_sug::numeric, 7)::text, ''),
    coalesce(round(v_lon_sug::numeric, 7)::text, ''),
    coalesce(v_radio_sug::text, '')
  ));

  -- Un diagnóstico idéntico y reciente no crea una fila nueva: consultar la
  -- pantalla tres veces seguidas no debe llenar la tabla.
  select d.* into v_previo
  from public.ronda_punto_diagnosticos_gps d
  where d.ronda_punto_id = p_ronda_punto_id
    and d.firma          = v_firma
    and d.created_at    >= now() - make_interval(hours => v_reuso_horas)
  order by d.created_at desc
  limit 1;

  if found then
    return v_previo;
  end if;

  insert into public.ronda_punto_diagnosticos_gps (
    ronda_punto_id, ronda_base_id, firma,
    dias_analizados, visitas_consideradas,
    radio_actual, latitud_actual, longitud_actual,
    latitud_sugerida, longitud_sugerida, radio_sugerido,
    distancia_p50, distancia_p90, distancia_max, desplazamiento_metros,
    recomendacion, detalle, generado_por
  ) values (
    p_ronda_punto_id, v_punto.ronda_base_id, v_firma,
    v_dias, coalesce(v_n, 0),
    v_punto.radio_metros, v_punto.latitud, v_punto.longitud,
    v_lat_sug, v_lon_sug, v_radio_sug,
    v_p50, v_p90, v_max, v_desplaz,
    v_reco,
    jsonb_build_object(
      'metodo',              'mediana_p90',
      'min_visitas',         v_min_visitas,
      'precision_max_m',     v_precision_max,
      'margen_radio_m',      v_margen_radio,
      'radio_min_m',         v_radio_min,
      'radio_max_m',         v_radio_max,
      'umbral_desplazar_m',  v_umbral_desplazar,
      'umbral_radio_m',      v_umbral_radio,
      'gps_requerido_actual', v_punto.gps_requerido
    ),
    public.rondas_usuario_actual_id()
  )
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function public.diagnosticar_gps_ronda_punto(uuid, integer) is
  'Diagnostica la configuración GPS de un punto contra el historial real de '
  'visitas. No modifica el punto: devuelve y persiste una sugerencia firmada.';

revoke all on function public.diagnosticar_gps_ronda_punto(uuid, integer) from public;
revoke all on function public.diagnosticar_gps_ronda_punto(uuid, integer) from anon;
grant execute on function public.diagnosticar_gps_ronda_punto(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
