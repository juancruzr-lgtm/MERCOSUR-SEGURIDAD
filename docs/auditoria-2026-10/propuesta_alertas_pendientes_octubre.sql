-- ============================================================================
-- PROPUESTA — NO EJECUTAR SIN AUTORIZACIÓN EXPRESA (AGENTS.md)
-- Alertas de ronda pendientes de octubre 2026 (y anteriores): clasificación y
-- cierre SÓLO de lo objetivamente demostrable.
-- ============================================================================
-- Rama fix/rondas-historial-exigencias. Diseño: rondas_historial_exigencias.md §6.
--
-- Requisitos: aplicada 20261115120000_ronda_alertas_resultado_intervencion.sql
-- (columnas resultado_intervencion / motivo_intervencion / origen). Sin ella el
-- UPDATE falla y la transacción no deja nada.
--
-- El archivo termina en ROLLBACK: correrlo entero sólo MUESTRA el antes y el
-- después. Para aplicar, con autorización, cambiar el ROLLBACK final por COMMIT.
--
-- Clases (precedencia en este orden; cada alerta cae en una sola):
--   E  suspendida            · tipo 'suspendida' (el vigilador declaró que no
--                              podía hacer la ronda). REVISIÓN HUMANA.
--   C  no exigible           · turno anulado/reemplazado/cancelado, turno con
--                              ausencia registrada, objetivo de prueba, objetivo
--                              no activo EN ESE MOMENTO (objetivos_auditoria) o
--                              ventana bajo pausa. PROPUESTA DE CIERRE:
--                              resuelto · administrativa.
--   A  realizada en el turno · 'no_iniciada' con una ejecución posterior de la
--                              misma ronda y turno, y SIN otra alerta de la misma
--                              ronda+turno entre la ventana y esa ejecución (la
--                              ejecución es lo siguiente que pasó: equivale al
--                              cierre automático aprobado en 20261115120000 para
--                              episodios de una ventana). PROPUESTA DE CIERRE:
--                              resuelto · ronda_realizada, origen 'sistema'.
--   A' realizada con huecos  · igual que A pero con otras ventanas incumplidas en
--                              el medio: una ejecución no cumple varias ventanas.
--                              REVISIÓN HUMANA.
--   A2 no_finalizada que la ejecución terminó después. REVISIÓN HUMANA (no es
--                              el cierre automático aprobado).
--   C2 cae en un horario sin exigencia cargado DESPUÉS de la ventana (Laromet
--                              Baigorria, 19/10/2026). REVISIÓN HUMANA.
--   B  comentario del supervisor (sin ejecución que lo pruebe): p. ej. «informa
--                              haber realizado el recorrido», «relevado por
--                              personal policial». LISTA PARA CONFIRMAR; no se
--                              cierra sola.
--   D  incumplimiento real   · sin ejecución posterior, sin comentario, turno y
--                              objetivo exigibles. Queda pendiente.
--
-- Conteo de producción (SELECT de sólo lectura, 02/11/2026): 328 pendientes
-- con ventana en octubre, ninguna anterior (otras 17 son de noviembre y no se
-- tocan):
--   A 121 (cierre propuesto) · C 1 (cierre propuesto: ANTENA 10/10 02:30,
--   objetivo inactivo de 00:29 a 18:53 ese día)
--   A' 33 · A2 20 · B 4 · E 2 (revisión humana)
--   D 147 (quedan pendientes: LAROMET ROSARIO 2 47, CIRSE 29, SKATEPARK 24,
--   ANTENA 21, LA CASONA 14, DEPOSITO FISCAL 8, ACA 4)
--   B: LA CASONA 31/10 «relevado por personal policial», SKATEPARK 30/10
--   «pasó a cubrir La Casona», DEPOSITO FISCAL 30/10 «informa haber realizado
--   el recorrido», CIRSE 30/10 «inconvenientes en la plataforma».
-- ============================================================================

begin;

-- ── 0) Clasificación ─────────────────────────────────────────────────────────
create temp table _clasif on commit drop as
with a as (
  select a.*, t.estado as turno_estado, o.estado as objetivo_estado, o.es_prueba, o.nombre as objetivo,
         (a.ventana_inicio at time zone 'America/Argentina/Buenos_Aires') as vi_ar
    from public.ronda_alertas a
    join public.turnos t    on t.id = a.turno_id
    join public.objetivos o on o.id = a.objetivo_id
   where a.estado = 'pendiente'
     and a.ventana_inicio < ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
), f as (
  select a.*,
    (select min(e.iniciada_at) from public.ronda_ejecuciones e
      where e.ronda_base_id = a.ronda_base_id and e.turno_id = a.turno_id
        and e.estado in ('en_curso', 'finalizada') and e.iniciada_at >= a.ventana_inicio) as ejec_posterior,
    (select e.finalizada_at from public.ronda_ejecuciones e where e.id = a.ejecucion_id) as ejec_finalizada_at,
    coalesce(a.turno_estado, '') in ('anulado', 'reemplazado', 'cancelado') as turno_sin_obligacion,
    exists (select 1 from public.registros_asistencia ra
             where ra.turno_id = a.turno_id and ra.tipo_registro = 'ausencia') as turno_con_ausencia,
    coalesce((select x.valor_anterior from public.objetivos_auditoria x
               where x.objetivo_id = a.objetivo_id and x.campo = 'estado' and x.created_at > a.ventana_inicio
               order by x.created_at, x.id limit 1), a.objetivo_estado) as objetivo_estado_en_ventana,
    exists (select 1 from public.ronda_horarios_sin_exigencia h
             where h.ronda_base_id = a.ronda_base_id and h.activo
               and h.dia_semana = extract(isodow from a.vi_ar)::int
               and a.vi_ar::time >= h.desde and a.vi_ar::time < h.hasta) as en_horario_sin_exigencia,
    exists (select 1 from public.ronda_pausas p
             where p.ronda_base_id = a.ronda_base_id and p.pausada_at <= a.ventana_inicio
               and ((p.activa and p.hasta_at is null)
                    or (p.activa and p.hasta_at is not null and a.ventana_inicio < p.hasta_at)
                    or (not p.activa and p.reactivada_at is not null and a.ventana_inicio < p.reactivada_at))) as bajo_pausa,
    (select string_agg(i.comentario, ' | ' order by i.created_at) from public.ronda_alerta_intervenciones i
      where i.ronda_alerta_id = a.id and nullif(btrim(i.comentario), '') is not null) as comentarios
  from a
)
select f.*,
  (f.ejec_posterior is not null and not exists (
     select 1 from public.ronda_alertas b
      where b.ronda_base_id = f.ronda_base_id and b.turno_id = f.turno_id
        and b.tipo in ('no_iniciada', 'no_finalizada')
        and b.ventana_inicio > f.ventana_inicio and b.ventana_inicio < f.ejec_posterior)) as ejecucion_es_lo_siguiente,
  case
    when f.tipo = 'suspendida'                                            then 'E_suspendida'
    when f.turno_sin_obligacion or f.turno_con_ausencia or f.es_prueba
         or f.objetivo_estado_en_ventana <> 'activo' or f.bajo_pausa      then 'C_no_exigible'
    when f.tipo = 'no_iniciada' and f.ejec_posterior is not null and not exists (
           select 1 from public.ronda_alertas b
            where b.ronda_base_id = f.ronda_base_id and b.turno_id = f.turno_id
              and b.tipo in ('no_iniciada', 'no_finalizada')
              and b.ventana_inicio > f.ventana_inicio and b.ventana_inicio < f.ejec_posterior)
                                                                          then 'A_realizada_en_turno'
    when f.tipo = 'no_iniciada' and f.ejec_posterior is not null          then 'A1_realizada_con_huecos'
    when f.tipo = 'no_finalizada' and f.ejec_finalizada_at is not null    then 'A2_finalizada_tarde'
    when f.en_horario_sin_exigencia                                       then 'C2_horario_declarado_despues'
    when f.comentarios is not null                                        then 'B_comentario_supervisor'
    else 'D_incumplimiento'
  end as clase
from f;

-- ── 1) ANTES: conteo por clase ───────────────────────────────────────────────
select clase, tipo, to_char(vi_ar, 'YYYY-MM') as mes, count(*) as alertas
  from _clasif group by 1, 2, 3 order by 1, 2, 3;

-- ── 2) Listas para revisión humana (no se tocan) ─────────────────────────────
select clase, id as alerta_id, objetivo, tipo,
       to_char(vi_ar, 'DD/MM HH24:MI') as ventana,
       to_char(ejec_posterior at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') as ejecucion_posterior,
       comentarios
  from _clasif
 where clase in ('B_comentario_supervisor', 'E_suspendida', 'C2_horario_declarado_despues',
                 'A1_realizada_con_huecos', 'A2_finalizada_tarde')
 order by clase, vi_ar;

-- ── 3) D por objetivo (queda pendiente) ──────────────────────────────────────
select objetivo, count(*) as alertas, min(vi_ar)::date as desde, max(vi_ar)::date as hasta
  from _clasif where clase = 'D_incumplimiento' group by 1 order by 2 desc;

-- ── 4) CIERRE PROPUESTO: sólo A y C ──────────────────────────────────────────
-- Igual que el cierre automático del evaluador: accion 'resuelta' (NO
-- 'justificacion': Cumplimiento y Mi Desempeño siguen midiendo por ejecución),
-- intervención de origen 'sistema' con el texto que explica la regla.
with cerradas as (
  update public.ronda_alertas a
     set estado                 = 'resuelta',
         resuelta_por           = null,
         resuelta_at            = now(),
         accion                 = 'resuelta',
         comentario             = case c.clase
           when 'A_realizada_en_turno' then
             'Regularización oct-2026: la ronda se inició a las '
             || to_char(c.ejec_posterior at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
             || ' dentro del mismo turno.'
           else
             'Regularización oct-2026: la ventana no era exigible ('
             || case when c.turno_sin_obligacion then 'turno ' || c.turno_estado
                     when c.turno_con_ausencia   then 'turno con ausencia'
                     when c.es_prueba            then 'objetivo de prueba'
                     when c.bajo_pausa           then 'ronda pausada'
                     else 'objetivo ' || c.objetivo_estado_en_ventana || ' en ese momento' end
             || ').'
         end,
         resultado_intervencion = 'resuelto',
         motivo_intervencion    = case c.clase when 'A_realizada_en_turno' then 'ronda_realizada' else 'administrativa' end,
         seguimiento_hasta      = null,
         updated_at             = now()
    from _clasif c
   where a.id = c.id
     and c.clase in ('A_realizada_en_turno', 'C_no_exigible')
     and a.estado = 'pendiente'                       -- idempotente: lo ya cerrado no se toca
  returning a.id, a.comentario, a.motivo_intervencion
)
insert into public.ronda_alerta_intervenciones
  (ronda_alerta_id, supervisor_id, origen, accion, comentario, estado_anterior, estado_nuevo, resultado, motivo)
select x.id, null, 'sistema', 'resuelta', x.comentario, 'pendiente', 'resuelta', 'resuelto', x.motivo_intervencion
  from cerradas x;

-- ── 5) DESPUÉS ───────────────────────────────────────────────────────────────
select c.clase, a.estado, a.resultado_intervencion, a.motivo_intervencion, count(*)
  from _clasif c join public.ronda_alertas a on a.id = c.id
 group by 1, 2, 3, 4 order by 1, 2;

select count(*) as intervenciones_sistema_nuevas
  from public.ronda_alerta_intervenciones i
  join _clasif c on c.id = i.ronda_alerta_id
 where i.origen = 'sistema' and i.created_at >= now() - interval '1 minute';

rollback;   -- ← cambiar por COMMIT sólo con autorización expresa
