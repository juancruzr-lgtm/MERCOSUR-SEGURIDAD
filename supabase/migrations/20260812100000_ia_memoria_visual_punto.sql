-- ═══════════════════════════════════════════════════════════════════════════
-- MEMORIA VISUAL POR PUNTO DE RONDA
--
-- Qué resuelve
--   Una sola foto de referencia no describe un lugar. El mismo portón de noche,
--   con lluvia o con una camioneta adelante son imágenes muy distintas del mismo
--   punto, y comparar contra una única foto produce falsos "no coincide".
--   A partir de acá, cada punto acumula fotos reales que una PERSONA confirmó,
--   y esas fotos viajan como contexto en el próximo análisis.
--
-- Qué NO hace
--   No entrena ningún modelo. No genera verdad automática. Sólo una decisión
--   humana incorpora una foto al conjunto: una predicción de la IA jamás se
--   auto-confirma. Sin esa regla, un error se convertiría en norma.
--
-- Naturaleza
--   Aditiva. Una columna nullable, dos índices, una vista y tres claves de
--   configuración. No borra ni modifica ninguna fila existente salvo el backfill
--   de la columna nueva, que hoy está en NULL en todas.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Vínculo directo análisis → punto de ronda ───────────────────────────
-- Denormalización deliberada. El dato ya existe, pero llegar a él exige
-- evidencias → ronda_ejecucion_puntos → ronda_punto_id. Hacer ese recorrido por
-- cada foto, dentro del presupuesto de 45 s de la función, es caro y frágil.
-- Con la columna, juntar la memoria de un punto es una sola consulta indexada,
-- y medir aciertos por punto deja de necesitar el join.
--
-- Nullable a propósito: uniforme y libro_guardia no pertenecen a ningún punto.
alter table public.evidencia_analisis
  add column if not exists ronda_punto_id uuid
    references public.ronda_puntos(id) on delete set null;

comment on column public.evidencia_analisis.ronda_punto_id is
  'Punto de ronda al que pertenece la evidencia. NULL para uniforme y libro_guardia. '
  'Denormalizado desde ronda_ejecucion_puntos para poder armar la memoria visual '
  'y las métricas por punto sin recorrer el join en cada análisis.';

-- Índice de la consulta caliente: "ejemplos confirmados de este punto, los más
-- recientes primero". Parcial porque la mayoría de las filas tiene NULL acá.
create index if not exists idx_evidencia_analisis_punto_revision
  on public.evidencia_analisis (ronda_punto_id, revision_estado, revisado_at desc)
  where ronda_punto_id is not null;

-- ── 2. Backfill ───────────────────────────────────────────────────────────
-- Sólo escribe donde hoy hay NULL. Recupera los análisis de ronda ya hechos
-- para que su revisión humana no se pierda como ejemplo.
update public.evidencia_analisis a
set    ronda_punto_id = rep.ronda_punto_id
from   public.evidencias ev
join   public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
where  a.evidencia_id = ev.id
  and  a.analisis_tipo = 'punto_control'
  and  a.ronda_punto_id is null
  and  rep.ronda_punto_id is not null;

-- ── 3. Configuración ──────────────────────────────────────────────────────
-- Los topes son de cuota, no de calidad: cada imagen extra es otro bloque de
-- tokens en cada análisis, todos los días.
insert into public.app_config (key, value, description)
values
  ('ia_memoria_max_positivos', '3',
   'Fotos confirmadas CORRECTAS del mismo punto que se envían como contexto.'),
  ('ia_memoria_max_negativos', '1',
   'Fotos confirmadas INCORRECTAS del mismo punto que se envían como contexto.'),
  ('ia_memoria_minimo_historial', '1',
   'Ejemplos positivos necesarios para considerar que un punto tiene historial propio.'),
  ('ia_ronda_solo_gps_fuera_radio', 'false',
   'true = analizar únicamente fotos de ronda con GPS fuera de radio. '
   'Por defecto false: GPS y foto son controles independientes. La clave faltaba '
   'y el cron la leía como true, sesgando el historial hacia los casos anómalos.')
on conflict (key) do nothing;

-- ── 4. Métricas por punto ─────────────────────────────────────────────────
-- Vista, no tabla: se deriva de datos que ya existen y no puede quedar
-- desincronizada. Nadie la escribe, así que nadie puede falsearla.
--
-- Convención de aciertos, la misma que ya usa la bandeja:
--   revision_estado = INCORRECTO  →  la foto estaba mal
--   revision_estado = CORRECTO    →  la foto estaba bien
-- Falso positivo  = la IA marcó REVISAR y la persona dijo que estaba bien.
-- Falso negativo  = la IA no marcó nada y la persona dijo que estaba mal.
--                   Es el error caro: es el que nadie ve.
create or replace view public.ia_metricas_punto as
select
  p.id                                  as ronda_punto_id,
  p.ronda_base_id,
  p.nombre                              as punto_nombre,
  rb.objetivo_id,
  count(a.id)                           as analizadas,
  count(*) filter (where a.revision_estado = 'CORRECTO')    as correctas_humano,
  count(*) filter (where a.revision_estado = 'INCORRECTO')  as incorrectas_humano,
  count(*) filter (where a.revision_estado = 'PENDIENTE')   as pendientes,
  count(*) filter (
    where a.clasificacion_efectiva = 'REVISAR'
      and a.revision_estado = 'CORRECTO')                   as falsos_positivos,
  count(*) filter (
    where a.clasificacion_efectiva = 'SIN_OBSERVACIONES'
      and a.revision_estado = 'INCORRECTO')                 as falsos_negativos,
  count(*) filter (
    where a.clasificacion_efectiva <> 'SIN_OBSERVACIONES'
      and a.revision_estado = 'INCORRECTO')                 as verdaderos_positivos,
  -- Ejemplos disponibles hoy para armar la memoria visual de este punto.
  count(*) filter (where a.revision_estado = 'CORRECTO')    as ejemplos_positivos,
  (select count(*) from public.ronda_punto_referencias r
    where r.ronda_punto_id = p.id and r.activo)             as referencias_formales
from public.ronda_puntos p
join public.rondas_base rb on rb.id = p.ronda_base_id
left join public.evidencia_analisis a
  on a.ronda_punto_id = p.id
 and a.estado = 'completado'
group by p.id, p.ronda_base_id, p.nombre, rb.objetivo_id;

comment on view public.ia_metricas_punto is
  'Aciertos de la IA por punto de ronda. Derivada: no se escribe, no se puede falsear. '
  'La precisión se calcula en la aplicación para no fijar acá una división por cero.';

-- La vista hereda el RLS de las tablas base (security_invoker), así que cada
-- usuario ve exactamente los puntos que ya podía ver.
alter view public.ia_metricas_punto set (security_invoker = on);

grant select on public.ia_metricas_punto to authenticated;

commit;
