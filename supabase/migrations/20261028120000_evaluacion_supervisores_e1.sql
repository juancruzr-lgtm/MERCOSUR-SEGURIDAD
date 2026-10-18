-- Evaluación de supervisores — Etapa 1: reporte de SÓLO LECTURA.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Por supervisor y período: horas y jornadas de guardia, supervisiones,
-- vencimientos de supervisión de objetivos de su zona, y las alertas de ronda
-- que le tocaron: cuántas intervino, cuántas atendió otro, cuántas se cerraron
-- sin intervención y cuántas quedaron sin atender. También el tiempo hasta la
-- intervención y la reincidencia del vigilador sin acción correctiva.
--
-- ── Decisiones de JC (16/10/2026) ────────────────────────────────────────────
--  P1 · Si hay dos de guardia, la alerta es de LOS DOS. Si uno interviene, al
--       otro le figura «intervenida por otro» (no le resta).
--  P2 · Los jefes de supervisores entran en el ranking como uno más.
--  P3 · La evaluación arranca el 08/10/2026. Antes = sólo referencia
--       (el cierre administrativo masivo del 07/10 queda afuera).
--  P5 · Ven la evaluación sólo Dirección Operativa y Gerencia (incluye la
--       delegación gerencial vigente). Jefes y supervisores, no.
--
-- ── Atribución ───────────────────────────────────────────────────────────────
-- Una alerta de ronda es de los supervisores a los que se les AVISÓ (push
-- registrada en notificaciones_enviadas, que guarda el id de la alerta). Ese
-- aviso es la foto de quién estaba a cargo en ese momento: si después se edita
-- el calendario (como el intercambio del 13/10) la evaluación no cambia.
-- Si no hubo aviso registrado, se usa el calendario: espejo SQL de
-- lib/responsables-operativos.ts (guardia efectiva → único de zona → nadie).
-- Verificado contra producción 08/10–16/10: 180/187 coinciden; las 7
-- diferencias son del 08/10 y vienen del intercambio posterior del calendario.
--
-- ── Qué NO hace ──────────────────────────────────────────────────────────────
-- No crea tablas, no escribe datos, no agrega triggers ni crons. Sólo funciones
-- STABLE. No mide «visto» (no existe hasta la Etapa 2) ni fallas de asistencia
-- persistidas (Etapa 3): de asistencia da avisos recibidos y acciones hechas.
--
-- Rollback: supabase/rollback/20261028120000_evaluacion_supervisores_e1_rollback.sql

begin;

-- ============================================================================
-- 1. QUIÉN VE: Dirección Operativa, Gerencia o delegación gerencial vigente
-- ============================================================================
create or replace function public.puede_evaluar_supervisores_actual()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid() and u.estado = 'activo'
       and u.puesto_organizacional in ('direccion_operativa', 'gerencia')
  ) or public.tiene_delegacion_gerencia_actual()
$$;

-- ============================================================================
-- 2. RESPONSABLES POR CALENDARIO (respaldo cuando no hubo aviso)
-- ============================================================================
create or replace function public.responsables_supervision_en(p_zona_id uuid, p_instante timestamptz)
returns table (supervisor_id uuid, origen text)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
declare
  v_local timestamp := p_instante at time zone 'America/Argentina/Buenos_Aires';
  v_zona  text;
begin
  v_zona := (select lower(trim(z.nombre)) from public.zonas_operativas z where z.id = p_zona_id);
  if v_zona is null then
    return;
  end if;

  return query
    select distinct g.supervisor_id, 'guardia_efectiva'::text
      from public.supervisores_guardia g
     where lower(trim(g.zona)) = v_zona
       and coalesce(g.estado, 'activo') = 'activo'
       and coalesce(g.rol_operativo, 'supervisor') = 'supervisor'
       and coalesce(g.tipo_evento, 'normal') not in ('franco', 'ausencia')
       and g.fecha in (v_local::date, v_local::date - 1)
       and v_local >= g.fecha + g.hora_inicio
       and v_local <  g.fecha + g.hora_fin
                      + case when g.hora_fin <= g.hora_inicio then interval '1 day' else interval '0' end;
  if found then
    return;
  end if;

  -- Sin guardia: el único asignado activo de la zona (varios → nadie).
  if (select count(*) from public.supervisor_zonas sz
        join public.usuarios u on u.id = sz.supervisor_id and u.estado = 'activo'
       where sz.zona_id = p_zona_id) = 1 then
    return query
      select sz.supervisor_id, 'unico_responsable_zona'::text
        from public.supervisor_zonas sz
        join public.usuarios u on u.id = sz.supervisor_id and u.estado = 'activo'
       where sz.zona_id = p_zona_id;
  end if;
end;
$$;

-- ============================================================================
-- 3. ALERTAS DE RONDA ATRIBUIDAS: una fila por (alerta × supervisor)
--    estado_atencion (excluyente, en este orden):
--      intervenida_propia · intervenida_por_otro · cerrada_sin_intervencion · sin_atender
--    Intervención = acción de una persona en ronda_alerta_intervenciones que NO
--    sea cierre_administrativo.
-- ============================================================================
create or replace function public.evaluacion_rondas_atribuidas(p_desde date, p_hasta date)
returns table (
  ronda_alerta_id        uuid,
  supervisor_id          uuid,
  origen_atribucion      text,
  tipo                   text,
  objetivo_id            uuid,
  guardia_id             uuid,
  detectada_at           timestamptz,
  primera_propia_at      timestamptz,
  minutos_a_intervenir   numeric,
  estado_atencion        text,
  reincidente_sin_accion boolean
)
language sql stable security definer
set search_path = public, pg_catalog as $$
  with params as (
    select (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires') as t0,
           ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1
  ),
  alertas as (
    select ra.id, ra.tipo, ra.estado, ra.objetivo_id, ra.guardia_id, ra.detectada_at, o.zona_id
      from public.ronda_alertas ra
      join public.objetivos o on o.id = ra.objetivo_id and coalesce(o.es_prueba, false) = false
      cross join params p
     where ra.detectada_at >= p.t0 and ra.detectada_at < p.t1
  ),
  avisados as (
    select a.id, n.usuario_id as sup, 'aviso'::text as origen
      from alertas a
      join public.notificaciones_enviadas n
        on n.tipo = 'supervisor_ronda_' || a.tipo || ':' || a.id::text
     group by 1, 2
  ),
  atrib as (
    select a.*, av.sup, av.origen
      from alertas a join avisados av on av.id = a.id
    union all
    select a.*, r.supervisor_id, r.origen
      from alertas a
      cross join lateral public.responsables_supervision_en(a.zona_id, a.detectada_at) r
     where not exists (select 1 from avisados av where av.id = a.id)
  ),
  interv as (
    select i.ronda_alerta_id, i.supervisor_id, min(i.created_at) as primera
      from public.ronda_alerta_intervenciones i
     where i.accion <> 'cierre_administrativo'
       and i.supervisor_id is not null
       and i.ronda_alerta_id in (select id from alertas)
     group by 1, 2
  )
  select
    x.id, x.sup, x.origen, x.tipo, x.objetivo_id, x.guardia_id, x.detectada_at,
    ip.primera,
    round((extract(epoch from ip.primera - x.detectada_at) / 60.0)::numeric, 1),
    case
      when ip.primera is not null then 'intervenida_propia'
      when exists (select 1 from interv io where io.ronda_alerta_id = x.id and io.supervisor_id <> x.sup)
        then 'intervenida_por_otro'
      when x.estado = 'resuelta' then 'cerrada_sin_intervencion'
      else 'sin_atender'
    end,
    -- 3ª falla o más del mismo vigilador y tipo en 14 días, sin llamada ni
    -- pedido de cumplimiento de nadie sobre las anteriores.
    ( x.guardia_id is not null
      and (select count(*) from public.ronda_alertas p
            where p.guardia_id = x.guardia_id and p.tipo = x.tipo
              and p.detectada_at >= x.detectada_at - interval '14 days'
              and p.detectada_at <  x.detectada_at) >= 2
      and not exists (
            select 1 from public.ronda_alertas p
              join public.ronda_alerta_intervenciones i on i.ronda_alerta_id = p.id
             where p.guardia_id = x.guardia_id
               and p.detectada_at >= x.detectada_at - interval '14 days'
               and p.detectada_at <  x.detectada_at
               and i.accion in ('llamada_vigilador', 'solicitud_cumplimiento')) )
  from atrib x
  left join interv ip on ip.ronda_alerta_id = x.id and ip.supervisor_id = x.sup
$$;

-- ============================================================================
-- 4. VENCIMIENTOS DE SUPERVISIÓN
--    Un vencimiento = la siguiente supervisión válida (o ahora) llegó más
--    tarde que última + frecuencia_supervision_horas. Entra todo vencimiento
--    que se superpone con el período (también el que venía vencido de antes).
--    Se atribuye por calendario al instante en que venció (o al inicio del
--    período, si venció antes), y sólo si el objetivo tuvo turnos mientras
--    estuvo vencido. horas_vencido = la parte dentro del período.
--    Simplificación E1: todas las horas van al responsable de ese instante,
--    aunque el vencimiento cruce varias guardias. Objetivos que NUNCA se
--    supervisaron no aparecen (no tienen desde cuándo contar).
-- ============================================================================
create or replace function public.evaluacion_vencimientos_supervision(p_desde date, p_hasta date)
returns table (
  objetivo_id     uuid,
  supervisor_id   uuid,
  vencio_at       timestamptz,
  regularizado_at timestamptz,
  horas_vencido   numeric
)
language sql stable security definer
set search_path = public, pg_catalog as $$
  with params as (
    select (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
           least(now(), (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1
  ),
  sup as (
    select s.objetivo_id, s.created_at,
           lead(s.created_at) over (partition by s.objetivo_id order by s.created_at) as siguiente
      from public.supervisiones s
     where s.estado <> 'incompleta'
  ),
  venc as (
    select o.id as objetivo_id, o.zona_id,
           s.created_at + make_interval(hours => o.frecuencia_supervision_horas) as vencio_at,
           s.siguiente as regularizado_at
      from sup s
      join public.objetivos o on o.id = s.objetivo_id
     where o.estado = 'activo' and coalesce(o.es_prueba, false) = false
       and o.frecuencia_supervision_horas is not null
       and coalesce(s.siguiente, now()) > s.created_at + make_interval(hours => o.frecuencia_supervision_horas)
  )
  select v.objetivo_id, r.supervisor_id, v.vencio_at, v.regularizado_at,
         round((extract(epoch from least(coalesce(v.regularizado_at, p.t1), p.t1)
                                  - greatest(v.vencio_at, p.t0)) / 3600.0)::numeric, 1)
    from venc v
    cross join params p
    cross join lateral public.responsables_supervision_en(v.zona_id, greatest(v.vencio_at, p.t0)) r
   where v.vencio_at < p.t1
     and coalesce(v.regularizado_at, now()) > p.t0
     and exists (select 1 from public.turnos t
                  where t.objetivo_id = v.objetivo_id
                    and t.fecha between (greatest(v.vencio_at, p.t0) at time zone 'America/Argentina/Buenos_Aires')::date
                                    and (least(coalesce(v.regularizado_at, p.t1), p.t1) at time zone 'America/Argentina/Buenos_Aires')::date)
$$;

-- ============================================================================
-- 5. RESUMEN POR SUPERVISOR (lo que consume el ranking)
-- ============================================================================
create or replace function public.evaluacion_supervisores_periodo(p_desde date, p_hasta date)
returns table (
  supervisor_id                    uuid,
  supervisor                       text,
  puesto                           text,
  zonas                            text,
  es_referencia                    boolean,
  horas_guardia                    numeric,
  jornadas_guardia                 integer,
  supervisiones                    integer,
  vencimientos_supervision         integer,
  horas_objetivo_vencidas          numeric,
  rondas_alertas                   integer,
  rondas_intervenidas_propias      integer,
  rondas_intervenidas_por_otro     integer,
  rondas_cerradas_sin_intervencion integer,
  rondas_sin_atender               integer,
  mediana_min_intervencion         numeric,
  reincidencias_sin_accion         integer,
  asistencia_avisos                integer,
  asistencia_acciones              integer
)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
declare
  c_inicio constant date := date '2026-10-08';   -- P3: arranque de la evaluación
  v_t0 timestamptz := p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires';
  v_t1 timestamptz := (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
begin
  if not public.puede_evaluar_supervisores_actual() then
    raise exception 'sin permiso para ver la evaluación de supervisores' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
    raise exception 'rango inválido (máximo 92 días)' using errcode = '22023';
  end if;

  return query
  with sups as (
    select u.id, trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')) as nom,
           u.puesto_organizacional as pto
      from public.usuarios u
     where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
       and ( u.puesto_organizacional in ('supervisor', 'jefe_supervisores')
             or exists (select 1 from public.supervisor_zonas sz where sz.supervisor_id = u.id) )
  ),
  rr as (select * from public.evaluacion_rondas_atribuidas(p_desde, p_hasta)),
  vv as (select * from public.evaluacion_vencimientos_supervision(p_desde, p_hasta)),
  sv as (  -- misma regla que lib/resumen-guardia.ts: dos en el mismo objetivo en 10' = una
    select s.supervisor_id,
           case when lag(s.created_at) over w is null
                  or s.created_at - lag(s.created_at) over w > interval '10 minutes' then 1 else 0 end as cuenta
      from public.supervisiones s
     where s.estado <> 'incompleta' and s.created_at >= v_t0 and s.created_at < v_t1
    window w as (partition by s.supervisor_id, s.objetivo_id order by s.created_at)
  ),
  gg as (
    select g.supervisor_id,
           sum(extract(epoch from (g.hora_fin - g.hora_inicio)
               + case when g.hora_fin <= g.hora_inicio then interval '1 day' else interval '0' end) / 3600.0) as horas,
           count(distinct g.fecha) as jornadas
      from public.supervisores_guardia g
     where g.fecha between p_desde and p_hasta
       and coalesce(g.estado, 'activo') = 'activo'
       and coalesce(g.rol_operativo, 'supervisor') = 'supervisor'
       and coalesce(g.tipo_evento, 'normal') not in ('franco', 'ausencia')
     group by 1
  )
  select
    s.id, s.nom, s.pto,
    (select string_agg(z.nombre, ', ' order by z.nombre) from public.supervisor_zonas sz
       join public.zonas_operativas z on z.id = sz.zona_id where sz.supervisor_id = s.id),
    p_desde < c_inicio,
    round(coalesce(gg.horas, 0)::numeric, 1),
    coalesce(gg.jornadas, 0)::int,
    coalesce((select sum(sv.cuenta) from sv where sv.supervisor_id = s.id), 0)::int,
    (select count(*) from vv where vv.supervisor_id = s.id)::int,
    coalesce((select sum(vv.horas_vencido) from vv where vv.supervisor_id = s.id), 0),
    (select count(*) from rr where rr.supervisor_id = s.id)::int,
    (select count(*) from rr where rr.supervisor_id = s.id and rr.estado_atencion = 'intervenida_propia')::int,
    (select count(*) from rr where rr.supervisor_id = s.id and rr.estado_atencion = 'intervenida_por_otro')::int,
    (select count(*) from rr where rr.supervisor_id = s.id and rr.estado_atencion = 'cerrada_sin_intervencion')::int,
    (select count(*) from rr where rr.supervisor_id = s.id and rr.estado_atencion = 'sin_atender')::int,
    (select round((percentile_cont(0.5) within group (order by rr.minutos_a_intervenir))::numeric, 0)
       from rr where rr.supervisor_id = s.id and rr.minutos_a_intervenir is not null),
    (select count(*) from rr where rr.supervisor_id = s.id and rr.reincidente_sin_accion)::int,
    (select count(*) from public.notificaciones_enviadas n
      where n.usuario_id = s.id and n.created_at >= v_t0 and n.created_at < v_t1
        and n.tipo in ('supervisor_sin_fichaje', 'supervisor_sin_fichar_15', 'supervisor_tardanza',
                       'supervisor_fuera_radio', 'supervisor_puesto_descubierto'))::int,
    (select count(*) from public.supervisor_intervenciones i
      where i.supervisor_id = s.id and i.created_at >= v_t0 and i.created_at < v_t1
        and i.accion <> 'alerta_revisada')::int
  from sups s
  left join gg on gg.supervisor_id = s.id
  order by 2;
end;
$$;

-- ============================================================================
-- 6. DETALLE DE UN SUPERVISOR (alertas de ronda + vencimientos)
-- ============================================================================
create or replace function public.evaluacion_supervisor_detalle_rondas(p_supervisor_id uuid, p_desde date, p_hasta date)
returns table (
  ronda_alerta_id        uuid,
  origen_atribucion      text,
  tipo                   text,
  objetivo               text,
  vigilador              text,
  detectada_at           timestamptz,
  primera_propia_at      timestamptz,
  minutos_a_intervenir   numeric,
  estado_atencion        text,
  reincidente_sin_accion boolean
)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
begin
  if not public.puede_evaluar_supervisores_actual() then
    raise exception 'sin permiso para ver la evaluación de supervisores' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
    raise exception 'rango inválido (máximo 92 días)' using errcode = '22023';
  end if;
  return query
    select r.ronda_alerta_id, r.origen_atribucion, r.tipo, o.nombre,
           trim(coalesce(v.nombre, '') || ' ' || coalesce(v.apellido, '')),
           r.detectada_at, r.primera_propia_at, r.minutos_a_intervenir,
           r.estado_atencion, r.reincidente_sin_accion
      from public.evaluacion_rondas_atribuidas(p_desde, p_hasta) r
      left join public.objetivos o on o.id = r.objetivo_id
      left join public.usuarios  v on v.id = r.guardia_id
     where r.supervisor_id = p_supervisor_id
     order by r.detectada_at desc;
end;
$$;

create or replace function public.evaluacion_supervisor_detalle_vencimientos(p_supervisor_id uuid, p_desde date, p_hasta date)
returns table (
  objetivo        text,
  vencio_at       timestamptz,
  regularizado_at timestamptz,
  horas_vencido   numeric
)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
begin
  if not public.puede_evaluar_supervisores_actual() then
    raise exception 'sin permiso para ver la evaluación de supervisores' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
    raise exception 'rango inválido (máximo 92 días)' using errcode = '22023';
  end if;
  return query
    select o.nombre, v.vencio_at, v.regularizado_at, v.horas_vencido
      from public.evaluacion_vencimientos_supervision(p_desde, p_hasta) v
      join public.objetivos o on o.id = v.objetivo_id
     where v.supervisor_id = p_supervisor_id
     order by v.vencio_at desc;
end;
$$;

-- ============================================================================
-- 7. PERMISOS: las internas no se exponen; sólo las de pantalla
-- ============================================================================
revoke all on function public.responsables_supervision_en(uuid, timestamptz)                from public, anon, authenticated;
revoke all on function public.evaluacion_rondas_atribuidas(date, date)                      from public, anon, authenticated;
revoke all on function public.evaluacion_vencimientos_supervision(date, date)               from public, anon, authenticated;
revoke all on function public.puede_evaluar_supervisores_actual()                           from public, anon;
revoke all on function public.evaluacion_supervisores_periodo(date, date)                   from public, anon;
revoke all on function public.evaluacion_supervisor_detalle_rondas(uuid, date, date)        from public, anon;
revoke all on function public.evaluacion_supervisor_detalle_vencimientos(uuid, date, date)  from public, anon;
grant execute on function public.puede_evaluar_supervisores_actual()                          to authenticated;
grant execute on function public.evaluacion_supervisores_periodo(date, date)                  to authenticated;
grant execute on function public.evaluacion_supervisor_detalle_rondas(uuid, date, date)       to authenticated;
grant execute on function public.evaluacion_supervisor_detalle_vencimientos(uuid, date, date) to authenticated;

commit;
