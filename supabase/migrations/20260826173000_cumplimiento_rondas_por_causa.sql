-- Rondas por empleado, ahora separando las pausas por su causa.
--
-- QUE CAMBIA respecto de 20260826140000
-- La version anterior devolvia `bajo_pausa` como un solo numero y los motivos
-- en texto. Con eso no se podia puntuar: una pausa por "no le da ubicacion en
-- los puntos" y otra por "la pauso por que no se hace" salian sumadas en la
-- misma celda, y separarlas leyendo las palabras del motivo habria sido una
-- inferencia inventada.
--
-- Ahora que ronda_pausas tiene causa estructurada, la pausa se reparte en
-- cuatro cubetas segun quien es responsable de que la ronda no se hiciera:
--
--   pausa_atribuible      no_se_realiza                 -> la ronda era exigible
--   pausa_no_atribuible   tecnica_gps, configuracion,   -> el sistema no dejaba
--                         no_aplica                        o no correspondia
--   pausa_capacitacion    capacitacion                  -> falta ensenarla
--   pausa_sin_clasificar  otra, y TODAS las historicas  -> nadie lo dijo
--
-- `pausa_sin_clasificar` es la que mantiene la dimension en validacion. Todas
-- las pausas de agosto caen ahi, porque la causa no existia cuando se crearon.
-- No se les asigna ninguna: es exactamente lo que son.
--
-- LAS CUBETAS SON EXCLUYENTES, Y ESO IMPORTA
-- La precedencia es saneada > pausada > tipo de alerta, de modo que
--
--   obligaciones = saneadas + bajo_pausa + cumplidas
--                + no_iniciada + no_finalizada + suspendida
--
-- se cumple exactamente. Sin esa precedencia una ventana saneada Y pausada
-- sumaria en las dos columnas y el total no cerraria, que es justo lo que hace
-- imposible auditar un numero.
--
-- LO QUE NO CAMBIA
-- El universo sigue saliendo de rondas_ventanas_programadas, que es la unica
-- definicion de la obligacion. El alcance se sigue delegando en
-- puede_administrar_rondas_objetivo. Los motivos de texto se siguen devolviendo
-- tal cual, sin interpretar.

-- Cambia la forma de la tabla devuelta, asi que hay que recrearla. Es una
-- funcion de solo lectura: no hay datos que perder.
drop function if exists public.cumplimiento_rondas_por_empleado(date, date);

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
    select v.guardia_id,
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
    coalesce(max(motivos.j), '{}'::jsonb),
    coalesce(max(causas.j),  '{}'::jsonb)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  group by x.guardia_id;
$fn$;

comment on function public.cumplimiento_rondas_por_empleado(date, date) is
  'Rondas exigibles vs cumplidas por empleado, desde rondas_ventanas_programadas. '
  'Separa las ventanas bajo pausa segun la causa estructurada que eligio quien '
  'pauso. Las pausas sin causa —todas las anteriores a la clasificacion— salen '
  'como sin_clasificar y NO se interpretan a partir del texto del motivo.';

revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from anon;
grant execute on function public.cumplimiento_rondas_por_empleado(date, date) to authenticated;

notify pgrst, 'reload schema';
