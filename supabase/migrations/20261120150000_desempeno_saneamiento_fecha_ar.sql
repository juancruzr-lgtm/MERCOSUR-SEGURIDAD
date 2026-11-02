-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- Mi Desempeño: reconocer el saneamiento del 07/10 y cortar el período en hora
-- argentina
-- ============================================================================
--
-- No cambia el Modelo C ni la escala de notas: corrige DOS errores de lectura
-- de datos en cumplimiento_rondas_por_empleado y _servicio (20260901130000).
--
-- ── 1. Saneamiento no reconocido ────────────────────────────────────────────
-- El filtro excluía una alerta sólo si su comentario empezaba con
-- 'Saneamiento administrativo'. Los 318 cierres masivos del 07/10/2026 tienen
-- comentario '[Saneamiento 07/10/2026: …' (accion = 'cierre_administrativo'),
-- así que seguían contando como rondas incumplidas del vigilador.
--
-- Ahora una alerta NO penaliza (ronda_alerta_no_penaliza) si:
--   a. comentario empieza con 'Saneamiento administrativo' (criterio previo);
--   b. accion = 'cierre_administrativo' y el comentario menciona
--      «saneamiento» (sin importar mayúsculas ni corchetes). El marcador se
--      busca sólo en cierres administrativos: un texto libre de un vigilador
--      o de una llamada no alcanza;
--   c. tiene una intervención 'justificacion' (criterio previo) o un cierre
--      administrativo de saneamiento en ronda_alerta_intervenciones;
--   d. la resolución final de la intervención dice que la ronda se REALIZÓ o
--      que fue un error técnico/administrativo (motivo 'cumplida',
--      'realizada', 'error_tecnico', 'error_administrativo',
--      'administrativo'). Esas columnas las agrega otra migración
--      (resultado/motivo de la intervención); se leen con to_jsonb para que
--      esta función compile y funcione exista o no la columna:
--        ronda_alertas.motivo_intervencion
--        ronda_alerta_intervenciones.motivo (la intervención más reciente)
-- 'llamada_vigilador', 'solicitud_cumplimiento' y 'resuelta' sin motivo
-- siguen SIN excluir (20260901130000: gestionar no es justificar).
--
-- ── 2. Corte del período en UTC ─────────────────────────────────────────────
-- `a.ventana_inicio >= p_desde` comparaba contra medianoche UTC (21:00 del
-- día anterior en Argentina). Las alertas de 21:00 a 24:00 del ÚLTIMO día del
-- período quedaban afuera del join y esas ventanas se contaban como cumplidas.
-- Se compara contra la medianoche argentina (regla del repo: fechas operativas
-- en horario de Argentina).
--
-- Base: definiciones VIVAS (pg_get_functiondef, 02/11/2026); sólo cambian las
-- líneas marcadas [D]. Mismas firmas y columnas: CREATE OR REPLACE conserva
-- los permisos vigentes. No toca evaluaciones publicadas: cambia sólo lo que
-- se consulte de aquí en más.
-- Simulación de impacto (octubre 2026): docs/auditoria-2026-10/simulacion_desempeno_octubre.md
--
-- Rollback: supabase/rollback/20261120150000_desempeno_saneamiento_fecha_ar_rollback.sql
-- ============================================================================

begin;

-- ============================================================================
-- 1. Criterio único: ¿esta alerta penaliza al vigilador?
-- ============================================================================

create or replace function public.ronda_alerta_no_penaliza(p_alerta public.ronda_alertas)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with ult as (
    -- Intervención más reciente: su motivo es la resolución final.
    select to_jsonb(i) as j
      from public.ronda_alerta_intervenciones i
     where i.ronda_alerta_id = p_alerta.id
     order by i.created_at desc
     limit 1
  )
  select
       coalesce(p_alerta.comentario, '') like 'Saneamiento administrativo%'
    or (p_alerta.accion = 'cierre_administrativo'
        and coalesce(p_alerta.comentario, '') ilike '%saneamiento%')
    or exists (
         select 1 from public.ronda_alerta_intervenciones i
          where i.ronda_alerta_id = p_alerta.id
            and (i.accion = 'justificacion'
                 or (i.accion = 'cierre_administrativo'
                     and coalesce(i.comentario, '') ilike '%saneamiento%')))
    or lower(coalesce(to_jsonb(p_alerta) ->> 'motivo_intervencion', ''))
         in ('cumplida', 'realizada', 'error_tecnico', 'error_administrativo', 'administrativo')
    or lower(coalesce((select ult.j ->> 'motivo' from ult), ''))
         in ('cumplida', 'realizada', 'error_tecnico', 'error_administrativo', 'administrativo');
$fn$;

comment on function public.ronda_alerta_no_penaliza(public.ronda_alertas) is
  'Mi Desempeño: la alerta no cuenta contra el vigilador (saneamiento, justificación, ronda realizada '
  'o error técnico/administrativo). Ver 20261120150000.';

revoke all on function public.ronda_alerta_no_penaliza(public.ronda_alertas) from public;
revoke all on function public.ronda_alerta_no_penaliza(public.ronda_alertas) from anon;
revoke all on function public.ronda_alerta_no_penaliza(public.ronda_alertas) from authenticated;
grant execute on function public.ronda_alerta_no_penaliza(public.ronda_alertas) to service_role;

-- ============================================================================
-- 2. Con alcance por sesión (navegador)
-- ============================================================================

create or replace function public.cumplimiento_rondas_por_empleado(p_desde date, p_hasta date)
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
           public.ronda_alerta_no_penaliza(a) as saneada                      -- [D] criterio único
      from public.ronda_alertas a
     -- [D] Límites del período en hora argentina (antes: medianoche UTC, que
     -- dejaba afuera las alertas de 21:00 a 24:00 del último día y las
     -- contaba como rondas cumplidas).
     where a.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and a.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
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

-- ============================================================================
-- 3. Sin alcance (servidor, service_role)
-- ============================================================================

create or replace function public.cumplimiento_rondas_por_empleado_servicio(p_desde date, p_hasta date)
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
           public.ronda_alerta_no_penaliza(a) as saneada                      -- [D] criterio único
      from public.ronda_alertas a
     -- [D] Límites del período en hora argentina (antes: medianoche UTC, que
     -- dejaba afuera las alertas de 21:00 a 24:00 del último día y las
     -- contaba como rondas cumplidas).
     where a.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and a.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
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

notify pgrst, 'reload schema';

commit;

-- ── Verificación (después de aplicar) ───────────────────────────────────────
-- Alertas de octubre que no penalizan (deberían incluir los cierres del 07/10):
--   select count(*) filter (where public.ronda_alerta_no_penaliza(a)) as no_penalizan, count(*) as total
--     from public.ronda_alertas a
--    where a.ventana_inicio >= ('2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
--      and a.ventana_inicio <  ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires');
-- Comparar con la simulación: sum(saneadas), sum(no_iniciada) de
--   select * from public.cumplimiento_rondas_por_empleado_servicio('2026-10-01', '2026-10-31');
