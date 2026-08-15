-- ============================================================================
-- ROLLBACK · 20260814100000_supervisor_guardia_reglas
-- ============================================================================
--
-- Deshace la capa de programación semanal de supervisores.
--
-- QUÉ RESTITUYE:
--   - elimina la tabla supervisor_guardia_reglas y sus índices/policy
--   - elimina las 4 columnas agregadas a supervisores_guardia
--   - elimina el índice único de slot y los dos índices nuevos
--   - devuelve el default 'Rosario / General' a supervisores_guardia.zona
--
-- QUÉ NO TOCA: las filas de supervisores_guardia. Las guardias diarias
-- generadas desde una regla SIGUEN EXISTIENDO después del rollback; lo único
-- que se pierde es de qué regla salieron y qué excepción tenía cada una.
--
-- ⚠️  PÉRDIDA DE DATOS: se borran todas las reglas semanales cargadas y la
--     marca de franco/reemplazo/ausencia/cobertura de cada guardia. Antes de
--     ejecutarlo con datos reales, archivar:
--       create table respaldo_reglas_20260814 as
--         select * from public.supervisor_guardia_reglas;
--       create table respaldo_guardias_excepciones_20260814 as
--         select id, regla_id, origen, tipo_evento, supervisor_original_id
--         from public.supervisores_guardia
--         where tipo_evento <> 'normal' or regla_id is not null;
--
-- ⚠️  El índice único uq_supervisores_guardia_slot se elimina: después del
--     rollback vuelve a ser posible cargar dos guardias idénticas.
-- ============================================================================

begin;

drop index if exists public.uq_supervisores_guardia_slot;
drop index if exists public.idx_supervisores_guardia_regla;
drop index if exists public.idx_supervisores_guardia_zona_fecha;

alter table public.supervisores_guardia
  drop constraint if exists supervisores_guardia_origen_valido;
alter table public.supervisores_guardia
  drop constraint if exists supervisores_guardia_tipo_evento_valido;

alter table public.supervisores_guardia drop column if exists regla_id;
alter table public.supervisores_guardia drop column if exists origen;
alter table public.supervisores_guardia drop column if exists tipo_evento;
alter table public.supervisores_guardia drop column if exists supervisor_original_id;

-- Se restituye el default original aunque sea el equivocado: un rollback
-- devuelve el estado anterior, no lo corrige.
alter table public.supervisores_guardia alter column zona set default 'Rosario / General';

drop policy if exists supervisor_guardia_reglas_autenticado on public.supervisor_guardia_reglas;
drop table if exists public.supervisor_guardia_reglas;

commit;
