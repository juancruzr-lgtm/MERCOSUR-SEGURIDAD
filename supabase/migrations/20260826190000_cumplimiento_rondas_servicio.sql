-- Rondas por empleado para las rutas de servidor.
--
-- EL DEFECTO QUE ARREGLA
-- cumplimiento_rondas_por_empleado filtra por puede_administrar_rondas_objetivo,
-- que resuelve el alcance desde auth.uid(). Eso es correcto para el navegador,
-- donde hay sesion: admin ve todo, supervisor solo sus zonas.
--
-- Pero las rutas de servidor corren con service_role y ahi auth.uid() es NULL,
-- asi que la funcion devolvia CERO FILAS sin ningun error. El efecto era mudo y
-- caro: la ruta de entrenamiento nunca le habria ensenado a nadie sobre rondas
-- —para ella nadie tenia ninguna— y la simulacion de pesos habria dicho que
-- darle peso a Rondas no cambia nada, cuando en realidad ni siquiera estaba
-- mirando los datos.
--
-- POR QUE UNA FUNCION APARTE Y NO UN PARAMETRO
-- Un parametro tipo p_sin_filtro seria un interruptor para apagar el control de
-- acceso, a un typo de distancia desde cualquier llamada. Dos funciones con
-- grants distintos no se pueden confundir: esta NO esta concedida a
-- `authenticated`, asi que ninguna sesion de navegador puede invocarla, ni
-- siquiera la de un admin.
--
-- Mismo cuerpo, misma aritmetica, misma precedencia de cubetas. Lo unico que
-- cambia es el filtro de alcance, que aca no aplica porque no hay usuario a
-- quien recortarle nada: quien llama ya valido su permiso antes.

create or replace function public.cumplimiento_rondas_por_empleado_servicio(
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
    coalesce(motivos.j, '{}'::jsonb),
    coalesce(causas.j,  '{}'::jsonb)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  group by x.guardia_id, motivos.j, causas.j;
$fn$;

comment on function public.cumplimiento_rondas_por_empleado_servicio(date, date) is
  'Igual que cumplimiento_rondas_por_empleado pero SIN recorte por zona, para '
  'las rutas de servidor que corren con service_role —donde auth.uid() es NULL '
  'y el recorte devolveria cero filas en silencio—. NO se concede a '
  'authenticated: ninguna sesion de navegador puede invocarla. Quien la llama '
  'ya valido su permiso antes.';

revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from anon;
revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from authenticated;
grant execute on function public.cumplimiento_rondas_por_empleado_servicio(date, date) to service_role;

notify pgrst, 'reload schema';
