-- Rondas por empleado, para el Cumplimiento Operativo.
--
-- POR QUE UNA RPC Y NO UNA CONSULTA DEL CLIENTE
-- rondas_ventanas_programadas() es la definicion unica de la obligacion y esta
-- revocada para `authenticated` a proposito. Existe un espejo en TypeScript
-- (ventanasRondaEnTurno) pero su propio comentario aclara que NO genera
-- obligaciones: sirve para previsualizar una configuracion. Usarlo para puntuar
-- seria crear una segunda fuente de verdad sobre cuantas rondas debia hacer una
-- persona, y tarde o temprano las dos dirian numeros distintos.
--
-- Asi que el agregado se calcula donde vive la autoridad y se devuelve ya
-- resumido.
--
-- QUE NO HACE
-- No clasifica el motivo de la pausa. Los motivos son texto libre —"la pauso
-- por que no se hace" convive con "No le da ubicacion en los puntos"— y
-- adivinar cual es tecnico por palabras seria una inferencia inventada que
-- decide si una persona baja de categoria. Se devuelven los motivos tal cual,
-- agrupados, para que una persona los lea.
--
-- ALCANCE
-- Admin ve todo; supervisor solo sus zonas. Se delega en
-- puede_administrar_rondas_objetivo, que ya es la regla del modulo de rondas.

create or replace function public.cumplimiento_rondas_por_empleado(
  p_desde date,
  p_hasta date
)
returns table (
  guardia_id     uuid,
  obligaciones   integer,
  cumplidas      integer,
  no_iniciada    integer,
  no_finalizada  integer,
  suspendida     integer,
  saneadas       integer,
  bajo_pausa     integer,
  motivos_pausa  jsonb
)
language sql
security definer
set search_path = public, pg_catalog
as $BODY$
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
    select v.guardia_id, al.tipo, coalesce(al.saneada, false) as saneada,
           (select p.motivo
              from public.ronda_pausas p
             where p.ronda_base_id = v.ronda_base_id
               and p.pausada_at <= v.ventana_inicio
               and (p.reactivada_at is null or p.reactivada_at > v.ventana_inicio)
               and (p.hasta_at is null or p.hasta_at > v.ventana_inicio)
             limit 1) as motivo_pausa
      from v
      left join al
        on al.turno_id      = v.turno_id
       and al.ronda_base_id = v.ronda_base_id
       and al.ventana_inicio = v.ventana_inicio
  ), mp as (
    select x.guardia_id, x.motivo_pausa as motivo, count(*) as n
      from x where x.motivo_pausa is not null
     group by 1, 2
  ), motivos as (
    select mp.guardia_id, jsonb_object_agg(mp.motivo, mp.n) as j
      from mp group by 1
  )
  select
    x.guardia_id,
    count(*)::integer,
    count(*) filter (where x.tipo is null and x.motivo_pausa is null and not x.saneada)::integer,
    count(*) filter (where x.tipo = 'no_iniciada'   and not x.saneada and x.motivo_pausa is null)::integer,
    count(*) filter (where x.tipo = 'no_finalizada' and not x.saneada and x.motivo_pausa is null)::integer,
    count(*) filter (where x.tipo = 'suspendida'    and not x.saneada and x.motivo_pausa is null)::integer,
    count(*) filter (where x.saneada)::integer,
    count(*) filter (where x.motivo_pausa is not null)::integer,
    coalesce(max(motivos.j), '{}'::jsonb)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  group by x.guardia_id;
$BODY$;

comment on function public.cumplimiento_rondas_por_empleado(date, date) is
  'Rondas exigibles vs cumplidas por empleado, desde rondas_ventanas_programadas. '
  'No clasifica el motivo de pausa: lo devuelve tal cual para que lo lea una persona.';

revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from public;
revoke all on function public.cumplimiento_rondas_por_empleado(date, date) from anon;
grant execute on function public.cumplimiento_rondas_por_empleado(date, date) to authenticated;

notify pgrst, 'reload schema';
