-- ROLLBACK de 20260831120000_cumplimiento_rondas_por_turno.sql
--
-- Devuelve las dos funciones a sus 14 columnas: sin los conteos por turno.
-- Restaura exactamente el cuerpo de 20260826173000 (con alcance) y de
-- 20260826190000 (servicio).
--
-- Ejecutar solo si las columnas nuevas rompieron algo. Ojo: despues de esto,
-- lib/cumplimiento-fuentes.ts va a leer `turnos_con_obligacion` y encontrar
-- undefined; el codigo lo tolera con coalesce a 0, pero la UI de Rondas dejaria
-- de poder distinguir un episodio de un patron y la regla critica volveria a
-- comportarse como el Modelo A.
--
-- No toca datos: las dos funciones son de solo lectura.

begin;

drop function if exists public.cumplimiento_rondas_por_empleado(date, date);
drop function if exists public.cumplimiento_rondas_por_empleado_servicio(date, date);

create function public.cumplimiento_rondas_por_empleado(
  p_desde date,
  p_hasta date
)
returns table (
  guardia_id           uuid,
  obligaciones         integer,
  cumplidas            integer,
  no_iniciada          integer,
  no_finalizada        integer,
  suspendida           integer,
  saneadas             integer,
  bajo_pausa           integer,
  pausa_atribuible     integer,
  pausa_no_atribuible  integer,
  pausa_capacitacion   integer,
  pausa_sin_clasificar integer,
  motivos_pausa        jsonb,
  causas_pausa         jsonb
)
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  with v as (
    select x.*
      from public.rondas_ventanas_programadas(null, p_desde, p_hasta) x
     where x.vencimiento_at < now()
       and x.guardia_id is not null
       and public.puede_administrar_rondas_objetivo(x.objetivo_id)
  ), al as (
    select a.turno_id, a.ronda_base_id, a.ventana_inicio, a.tipo,
           coalesce(a.comentario, '') like 'Saneamiento administrativo%' as saneada
      from public.ronda_alertas a
     where a.ventana_inicio >= p_desde
       and a.ventana_inicio <  (p_hasta + 1)
  ), x as (
    select v.guardia_id, al.tipo,
           coalesce(al.saneada, false) as saneada,
           pa.motivo as motivo_pausa, pa.causa as causa_pausa,
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
      from x where x.pausada and not x.saneada group by 1, 2
  ), motivos as (
    select mp.guardia_id, jsonb_object_agg(mp.motivo, mp.n) as j from mp group by 1
  ), cp as (
    select x.guardia_id, coalesce(x.causa_pausa, 'sin_clasificar') as causa, count(*) as n
      from x where x.pausada and not x.saneada group by 1, 2
  ), causas as (
    select cp.guardia_id, jsonb_object_agg(cp.causa, cp.n) as j from cp group by 1
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
    coalesce(causas.j,  '{}'::jsonb)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  group by x.guardia_id, motivos.j, causas.j;
$fn$;

revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from anon;
grant execute on function public.cumplimiento_rondas_por_empleado(date, date) to authenticated;

create function public.cumplimiento_rondas_por_empleado_servicio(
  p_desde date,
  p_hasta date
)
returns table (
  guardia_id           uuid,
  obligaciones         integer,
  cumplidas            integer,
  no_iniciada          integer,
  no_finalizada        integer,
  suspendida           integer,
  saneadas             integer,
  bajo_pausa           integer,
  pausa_atribuible     integer,
  pausa_no_atribuible  integer,
  pausa_capacitacion   integer,
  pausa_sin_clasificar integer,
  motivos_pausa        jsonb,
  causas_pausa         jsonb
)
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  with v as (
    select x.*
      from public.rondas_ventanas_programadas(null, p_desde, p_hasta) x
     where x.vencimiento_at < now()
       and x.guardia_id is not null
  ), al as (
    select a.turno_id, a.ronda_base_id, a.ventana_inicio, a.tipo,
           coalesce(a.comentario, '') like 'Saneamiento administrativo%' as saneada
      from public.ronda_alertas a
     where a.ventana_inicio >= p_desde
       and a.ventana_inicio <  (p_hasta + 1)
  ), x as (
    select v.guardia_id, al.tipo,
           coalesce(al.saneada, false) as saneada,
           pa.motivo as motivo_pausa, pa.causa as causa_pausa,
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
      from x where x.pausada and not x.saneada group by 1, 2
  ), motivos as (
    select mp.guardia_id, jsonb_object_agg(mp.motivo, mp.n) as j from mp group by 1
  ), cp as (
    select x.guardia_id, coalesce(x.causa_pausa, 'sin_clasificar') as causa, count(*) as n
      from x where x.pausada and not x.saneada group by 1, 2
  ), causas as (
    select cp.guardia_id, jsonb_object_agg(cp.causa, cp.n) as j from cp group by 1
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
    coalesce(causas.j,  '{}'::jsonb)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  group by x.guardia_id, motivos.j, causas.j;
$fn$;

revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from anon;
revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from authenticated;
grant execute on function public.cumplimiento_rondas_por_empleado_servicio(date, date) to service_role;

notify pgrst, 'reload schema';

commit;
