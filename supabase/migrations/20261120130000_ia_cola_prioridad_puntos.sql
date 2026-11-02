-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- IA: cola de análisis con prioridad para los puntos de ronda sin otra validación
-- ============================================================================
--
-- ── Problema (auditoría de octubre 2026, verificado contra producción) ──────
-- 1.497 de 4.447 fotos de punto de octubre nunca tuvieron análisis. Causa:
-- /api/ia/cron (cada 5 min) pedía las `ia_lote_max` = 2 evidencias MÁS NUEVAS
-- (order by created_at desc), sin excluir las ya analizadas y mezclando los
-- tres tipos. Si en 5 minutos entraban más de 2 fotos, las restantes quedaban
-- detrás de otras más nuevas y no volvían a ser elegidas nunca: 1.446 de las
-- 1.497 perdidas cayeron en tramos de 5 minutos con más de 2 fotos. Además:
--   · si las 2 más nuevas ya estaban analizadas, la corrida no hacía nada;
--   · una fila que quedaba en 'procesando' (función cortada por timeout) no
--     se recuperaba nunca (67 en octubre);
--   · un 'error' con los intentos agotados quedaba en 'error' para siempre.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- ia_evidencias_por_analizar(...) devuelve las próximas evidencias a analizar,
-- de la más VIEJA a la más nueva, por prioridad:
--   1. foto de punto cuyo punto NO está validado por GPS ni por QR — de esa
--      foto depende si el punto se cumple (regla 20261120120000). Siempre.
--   2. uniforme y libro de guardia.
--   3. foto de punto ya validado por GPS o QR — sólo una muestra diaria
--      (p_muestra_validadas_dia, por defecto 20) para que la memoria visual
--      siga creciendo sin pagar el análisis de todas.
-- Excluye: lo ya completado (cualquier modo), lo marcado error_definitivo,
-- lo que otra corrida tiene 'procesando' hace menos de 10 minutos, los
-- errores con próximo intento en el futuro, puntos inexistentes (huérfanas),
-- evidencias sin objetivo, libro de guardia de objetivos móviles (que el
-- pipeline omite sin dejar fila y que, si no, bloquearían la cola) y lo más
-- viejo que p_antiguedad_max (por defecto 7 días: el atraso histórico es una
-- decisión aparte, ver docs/auditoria-2026-10/regla_validacion.md).
--
-- Sólo lee. El reclamo sigue siendo el de lib/ia/procesar.ts: el índice único
-- uq_evidencia_analisis_produccion impide dos filas para la misma evidencia y
-- los reintentos se reclaman con UPDATE condicionado (ver lib/ia/cola.ts).
--
-- Rollback: supabase/rollback/20261120130000_ia_cola_prioridad_puntos_rollback.sql
-- ============================================================================

begin;

create or replace function public.ia_evidencias_por_analizar(
  p_desde                 timestamptz,
  p_tipos                 text[],
  p_limite                integer  default 6,
  p_antiguedad_max        interval default interval '7 days',
  p_muestra_validadas_dia integer  default 20
)
returns table (evidencia_id uuid, tipo_evidencia text, prioridad integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with params as (
    select greatest(coalesce(p_desde, now()), now() - coalesce(p_antiguedad_max, interval '7 days')) as desde,
           -- Medianoche de hoy en Argentina (regla del repo: fechas operativas en hora argentina).
           (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
              at time zone 'America/Argentina/Buenos_Aires') as hoy
  ), cand as (
    select e.id, e.tipo_evidencia, e.created_at,
           case
             when e.tipo_evidencia = 'punto_control'
                  and (p.dentro_radio is true or p.qr_verificado_at is not null) then 3
             when e.tipo_evidencia = 'punto_control'                            then 1
             else                                                                    2
           end as prioridad
      from public.evidencias e
      left join public.ronda_ejecucion_puntos p
        on e.tipo_evidencia = 'punto_control' and p.id = e.proceso_id
      left join public.objetivos o on o.id = e.objetivo_id
     where e.tipo_evidencia = any (p_tipos)
       and e.created_at >= (select desde from params)
       and e.objetivo_id is not null
       and (e.tipo_evidencia <> 'punto_control' or p.id is not null)
       and not (e.tipo_evidencia = 'libro_guardia' and o.tipo_ubicacion is not distinct from 'movil')
       and not exists (
         select 1
           from public.evidencia_analisis a
          where a.evidencia_id  = e.id
            and a.analisis_tipo = e.tipo_evidencia
            and (    a.estado = 'completado'
                 or (a.modo = 'produccion' and a.estado = 'error_definitivo')
                 or (a.modo = 'produccion' and a.estado = 'procesando'
                     and a.updated_at > now() - interval '10 minutes')
                 or (a.modo = 'produccion' and a.estado = 'error'
                     and a.proximo_intento_at > now()))
       )
  ), cupo as (
    select greatest(0, coalesce(p_muestra_validadas_dia, 20) - (
             select count(*)
               from public.evidencia_analisis a
               join public.evidencias ev           on ev.id = a.evidencia_id
               join public.ronda_ejecucion_puntos p on p.id = ev.proceso_id
              where a.analisis_tipo = 'punto_control'
                and a.modo          = 'produccion'
                and a.created_at   >= (select hoy from params)
                and (p.dentro_radio is true or p.qr_verificado_at is not null)
           ))::integer as n
  ), elegidos as (
    select c.* from cand c where c.prioridad < 3
    union all
    (select c.* from cand c where c.prioridad = 3
      order by c.created_at
      limit (select n from cupo))
  )
  select el.id, el.tipo_evidencia, el.prioridad, el.created_at
    from elegidos el
   order by el.prioridad, el.created_at
   limit least(greatest(coalesce(p_limite, 6), 0), 50);
$fn$;

comment on function public.ia_evidencias_por_analizar(timestamptz, text[], integer, interval, integer) is
  'Cola del análisis automático de IA: más viejas primero; prioridad 1 = foto de punto sin GPS/QR válido, '
  '2 = uniforme/libro, 3 = muestra diaria de fotos de puntos ya validados. Sólo lectura. Ver 20261120130000.';

revoke all on function public.ia_evidencias_por_analizar(timestamptz, text[], integer, interval, integer) from public;
revoke all on function public.ia_evidencias_por_analizar(timestamptz, text[], integer, interval, integer) from anon;
revoke all on function public.ia_evidencias_por_analizar(timestamptz, text[], integer, interval, integer) from authenticated;
grant execute on function public.ia_evidencias_por_analizar(timestamptz, text[], integer, interval, integer) to service_role;

-- Apoya el anti-join por evidencia ya existente (idx_evidencia_analisis_evidencia)
-- y el filtro por fecha/tipo de evidencias.
create index if not exists idx_evidencias_tipo_fecha
  on public.evidencias (tipo_evidencia, created_at);

-- Claves de configuración nuevas (no pisan un valor ya cargado).
insert into public.app_config (key, value, description) values
  ('ia_muestra_puntos_validados_por_dia', '20',
   'Fotos de puntos ya validados por GPS/QR que la IA analiza por día (muestra para la memoria visual).'),
  ('ia_cola_max_dias', '7',
   'Antigüedad máxima (días) de una evidencia para entrar a la cola automática de IA.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;

-- ── Verificación (después de aplicar) ───────────────────────────────────────
-- Próximas 6 de la cola (no debería traer nada ya completado):
--   select * from public.ia_evidencias_por_analizar(
--     (select value::timestamptz from public.app_config where key = 'ia_activacion_desde'),
--     array['uniforme','libro_guardia','punto_control'], 6);
-- Fotos de punto de las últimas 24 h sin análisis completado (debería bajar a ~0):
--   select count(*) from public.evidencias e
--    where e.tipo_evidencia = 'punto_control' and e.created_at > now() - interval '24 hours'
--      and not exists (select 1 from public.evidencia_analisis a
--                       where a.evidencia_id = e.id and a.estado = 'completado');
