-- ROLLBACK de 20261220093000_cumplimiento_rondas_permiso_por_objetivo (F-15).
-- Definición viva en producción al 20/11/2026 antes de aplicar (md5 de pg_get_functiondef: c4d2e2e843a4889a79c93cb93dc8b735).
-- Ejecutar sólo si la versión nueva diera resultados distintos. CREATE OR REPLACE conserva los GRANT.

CREATE OR REPLACE FUNCTION public.cumplimiento_rondas_por_empleado(p_desde date, p_hasta date)
 RETURNS TABLE(guardia_id uuid, obligaciones integer, cumplidas integer, no_iniciada integer, no_finalizada integer, suspendida integer, saneadas integer, bajo_pausa integer, pausa_atribuible integer, pausa_no_atribuible integer, pausa_capacitacion integer, pausa_sin_clasificar integer, motivos_pausa jsonb, causas_pausa jsonb, turnos_con_obligacion integer, turnos_con_atribuibles integer, turnos_con_incumplimiento integer, turnos_sin_incumplimiento integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with v as (
    select x.*
      from public.rondas_ventanas_historicas(null, p_desde, p_hasta) x   -- [H] foto primero
     where x.estado_exigencia in ('exigible', 'pausada')                    -- [H]
       and x.vencimiento_at < now()
       and x.guardia_id is not null
       and public.puede_administrar_rondas_objetivo(x.objetivo_id)
  ), al as (
    select a.turno_id, a.ronda_base_id, a.ventana_inicio, a.tipo,
           public.ronda_alerta_no_penaliza(a) as saneada                      -- [D] criterio único
      from public.ronda_alertas a
     -- [D] Límites del período en hora argentina (antes: medianoche UTC, que
     -- dejaba afuera las alertas de 21:00 a 24:00 del último día y las
     -- contaba como rondas cumplidas).
     where a.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and a.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    -- [H] Ventanas agrupadas en un episodio (20261115120000): no tienen alerta
    -- propia y sin esto contaban como CUMPLIDAS. Cuentan como incumplidas con
    -- el criterio de la alerta del episodio (si el episodio no penaliza, por
    -- ejemplo cerrado por error técnico, sus ventanas tampoco).
    union all
    select w.turno_id, w.ronda_base_id, w.ventana_inicio, w.tipo,
           public.ronda_alerta_no_penaliza(ae) as saneada
      from public.ronda_alerta_ventanas_episodio w
      join public.ronda_alertas ae on ae.id = w.ronda_alerta_id
     where w.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and w.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and not exists (
         select 1 from public.ronda_alertas a2
          where a2.ronda_base_id = w.ronda_base_id and a2.turno_id = w.turno_id
            and a2.ventana_inicio = w.ventana_inicio)
  ), x as (
    select v.guardia_id,
           v.turno_id,
           al.tipo,
           coalesce(al.saneada, false) as saneada,
           pa.motivo as motivo_pausa,
           pa.causa  as causa_pausa,
           (pa.id is not null) as pausada
      from v
      left join al
        on al.turno_id       = v.turno_id
       and al.ronda_base_id  = v.ronda_base_id
       and al.ventana_inicio = v.ventana_inicio
      left join lateral (
        select p.id, p.motivo, p.causa
          from public.ronda_pausas p
         where p.ronda_base_id = v.ronda_base_id
           and p.pausada_at <= v.ventana_inicio
           and (p.reactivada_at is null or p.reactivada_at > v.ventana_inicio)
           and (p.hasta_at is null or p.hasta_at > v.ventana_inicio)
         order by p.pausada_at desc
         limit 1
      ) pa on true
  ), mp as (
    select x.guardia_id, x.motivo_pausa as motivo, count(*) as n
      from x where x.pausada and not x.saneada
     group by 1, 2
  ), motivos as (
    select mp.guardia_id, jsonb_object_agg(mp.motivo, mp.n) as j
      from mp group by 1
  ), cp as (
    select x.guardia_id,
           coalesce(x.causa_pausa, 'sin_clasificar') as causa,
           count(*) as n
      from x where x.pausada and not x.saneada
     group by 1, 2
  ), causas as (
    select cp.guardia_id, jsonb_object_agg(cp.causa, cp.n) as j
      from cp group by 1
  ), pt as (
    select x.guardia_id, x.turno_id,
           count(*) filter (where not x.saneada and not x.pausada) as atribuibles,
           count(*) filter (where x.tipo is not null and not x.saneada and not x.pausada) as incumplidas
      from x group by 1, 2
  ), tt as (
    select pt.guardia_id,
           count(*)::integer as turnos_con_obligacion,
           count(*) filter (where pt.atribuibles > 0)::integer as turnos_con_atribuibles,
           count(*) filter (where pt.incumplidas > 0)::integer as turnos_con_incumplimiento,
           count(*) filter (where pt.atribuibles > 0 and pt.incumplidas = 0)::integer as turnos_sin_incumplimiento
      from pt group by 1
  )
  select
    x.guardia_id,
    count(*)::integer,
    count(*) filter (where x.tipo is null and not x.pausada and not x.saneada)::integer,
    count(*) filter (where x.tipo = 'no_iniciada'   and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.tipo = 'no_finalizada' and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.tipo = 'suspendida'    and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.saneada)::integer,
    count(*) filter (where x.pausada and not x.saneada)::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa = 'no_se_realiza')::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa in ('tecnica_gps', 'configuracion', 'no_aplica'))::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa = 'capacitacion')::integer,
    count(*) filter (where x.pausada and not x.saneada and (x.causa_pausa is null or x.causa_pausa = 'otra'))::integer,
    coalesce(motivos.j, '{}'::jsonb),
    coalesce(causas.j,  '{}'::jsonb),
    coalesce(tt.turnos_con_obligacion, 0),
    coalesce(tt.turnos_con_atribuibles, 0),
    coalesce(tt.turnos_con_incumplimiento, 0),
    coalesce(tt.turnos_sin_incumplimiento, 0)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  left join tt      on tt.guardia_id      = x.guardia_id
  group by x.guardia_id, motivos.j, causas.j,
           tt.turnos_con_obligacion, tt.turnos_con_atribuibles,
           tt.turnos_con_incumplimiento, tt.turnos_sin_incumplimiento;
$function$;
