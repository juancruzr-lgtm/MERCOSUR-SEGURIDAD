-- Rondas por empleado: ademas de las ventanas, en CUANTOS TURNOS se repartieron.
--
-- QUE PROBLEMA RESUELVE
-- Hoy la funcion devuelve cuantas rondas se exigieron y cuantas se hicieron, y
-- nada mas. Con eso, estos dos casos reales de agosto son indistinguibles:
--
--   0 de 9 rondas, todas en UN turno       (OYOLA, que trabajo 23 turnos)
--   0 de 33 rondas, en CUATRO turnos       (GOMEZ, los cuatro incumplidos)
--
-- Los dos dan 0 %. Uno es un episodio y el otro es como trabaja la persona, y
-- la evaluacion no tenia forma de saber cual era cual: el dato para separarlos
-- —el turno— ya estaba en rondas_ventanas_programadas y se descartaba al
-- agrupar.
--
-- El turno sale de la RELACION REAL, `turno_id`, no de la fecha. Dos turnos del
-- mismo dia en el mismo objetivo son dos turnos, y un nocturno que cruza la
-- medianoche es uno solo: agrupar por fecha se equivocaria en los dos casos.
--
-- QUE NO CAMBIA
-- La aritmetica de ventanas. `obligaciones`, `cumplidas`, las cuatro cubetas de
-- pausa y los dos jsonb salen exactamente igual que antes, de las mismas
-- expresiones. Esto AGREGA cuatro columnas; no toca ninguna existente, asi que
-- el porcentaje de cumplimiento de todo el mundo queda igual al centesimo.
--
-- LAS CUATRO COLUMNAS
--   turnos_con_obligacion      turnos donde se genero al menos una ventana
--   turnos_con_atribuibles     de esos, en cuantos quedo algo exigible despues
--                              de sacar saneadas y pausadas. Es el denominador
--                              honesto: un turno cuyas 16 ventanas estan todas
--                              pausadas no se evaluo.
--   turnos_con_incumplimiento  turnos con al menos una ronda sin hacer
--   turnos_sin_incumplimiento  turnos evaluados donde se hizo todo
--
-- Se mantienen las dos funciones —la de sesion y la _servicio— con el mismo
-- cuerpo. Si divergieran, el navegador y el servidor contarian distinto.

begin;

-- Cambia la forma de la tabla devuelta: hay que recrearlas. Son de solo
-- lectura, no hay datos que perder.
drop function if exists public.cumplimiento_rondas_por_empleado(date, date);
drop function if exists public.cumplimiento_rondas_por_empleado_servicio(date, date);

-- ── Con alcance por sesion (navegador) ──────────────────────────────────────

create function public.cumplimiento_rondas_por_empleado(
  p_desde date,
  p_hasta date
)
returns table (
  guardia_id                uuid,
  obligaciones              integer,
  cumplidas                 integer,
  no_iniciada               integer,
  no_finalizada             integer,
  suspendida                integer,
  saneadas                  integer,
  bajo_pausa                integer,
  pausa_atribuible          integer,
  pausa_no_atribuible       integer,
  pausa_capacitacion        integer,
  pausa_sin_clasificar      integer,
  motivos_pausa             jsonb,
  causas_pausa              jsonb,
  turnos_con_obligacion     integer,
  turnos_con_atribuibles    integer,
  turnos_con_incumplimiento integer,
  turnos_sin_incumplimiento integer
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
    -- Una fila por TURNO. Es el nivel donde "incumplio o no" tiene sentido:
    -- una ventana suelta no es un turno incumplido.
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
  -- Los jsonb y los conteos de tt van al group by en vez de envolverse en un
  -- agregado: cada uno ya es unico por guardia_id —salen de CTEs agrupadas por
  -- guardia_id— asi que no parten ninguna fila. Y no existe max(jsonb).
  group by x.guardia_id, motivos.j, causas.j,
           tt.turnos_con_obligacion, tt.turnos_con_atribuibles,
           tt.turnos_con_incumplimiento, tt.turnos_sin_incumplimiento;
$fn$;

comment on function public.cumplimiento_rondas_por_empleado(date, date) is
  'Rondas exigibles vs cumplidas por empleado, desde rondas_ventanas_programadas. '
  'Separa las ventanas bajo pausa segun la causa estructurada que eligio quien '
  'pauso. Las pausas sin causa —todas las anteriores a la clasificacion— salen '
  'como sin_clasificar y NO se interpretan a partir del texto del motivo. '
  'Devuelve ademas en cuantos TURNOS se repartio la obligacion y en cuantos '
  'hubo incumplimiento: 0 % en un turno y 0 % en cuatro no son el mismo hecho.';

revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from anon;
grant execute on function public.cumplimiento_rondas_por_empleado(date, date) to authenticated;

-- ── Sin alcance, para rutas de servidor ─────────────────────────────────────
-- Mismo cuerpo sin el filtro de puede_administrar_rondas_objetivo: con
-- service_role auth.uid() es NULL y la version de arriba devolveria cero filas
-- sin ningun error. NO se concede a authenticated.

create function public.cumplimiento_rondas_por_empleado_servicio(
  p_desde date,
  p_hasta date
)
returns table (
  guardia_id                uuid,
  obligaciones              integer,
  cumplidas                 integer,
  no_iniciada               integer,
  no_finalizada             integer,
  suspendida                integer,
  saneadas                  integer,
  bajo_pausa                integer,
  pausa_atribuible          integer,
  pausa_no_atribuible       integer,
  pausa_capacitacion        integer,
  pausa_sin_clasificar      integer,
  motivos_pausa             jsonb,
  causas_pausa              jsonb,
  turnos_con_obligacion     integer,
  turnos_con_atribuibles    integer,
  turnos_con_incumplimiento integer,
  turnos_sin_incumplimiento integer
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
$fn$;

comment on function public.cumplimiento_rondas_por_empleado_servicio(date, date) is
  'Igual que cumplimiento_rondas_por_empleado pero SIN filtro de alcance, para '
  'rutas de servidor con service_role, donde auth.uid() es NULL y la version con '
  'alcance devolveria cero filas sin error. NO concedida a authenticated.';

revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from anon;
revoke all on function public.cumplimiento_rondas_por_empleado_servicio(date, date) from authenticated;
grant execute on function public.cumplimiento_rondas_por_empleado_servicio(date, date) to service_role;

notify pgrst, 'reload schema';

commit;
