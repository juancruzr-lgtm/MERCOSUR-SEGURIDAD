-- ============================================================================
-- ROLLBACK · Fijos/móviles e historial de ubicaciones vigentes
-- ============================================================================
--
-- NO EJECUTAR JUNTO CON LA MIGRACIÓN. Este archivo deshace, no instala.
--
-- ORDEN IMPORTANTE: lo PRIMERO que hace la etapa A es devolver el privilegio
-- de UPDATE sobre `objetivos` a `authenticated`. Si se corriera al final, entre
-- medio quedaría una ventana en la que nadie puede editar un objetivo y la RPC
-- ya no existe.
--
-- DOS ETAPAS. La A revierte el mecanismo y deja el sistema como estaba antes,
-- conservando el historial. La B destruye ese historial y está comentada.
-- ============================================================================

-- ── ETAPA A · Revertir el mecanismo (conserva el historial) ─────────────────

begin;

-- 1) Primero se devuelve el privilegio, para no dejar el sistema sin ninguna
--    forma de escribir la ubicación.
grant update on table public.objetivos to authenticated;

-- 2) Recién ahora se saca la ruta autoritativa.
drop function if exists public.establecer_ubicacion_objetivo(
  uuid, double precision, double precision, integer, timestamptz, text, text
);

drop trigger if exists trg_objetivos_vigencia_alta on public.objetivos;
drop function if exists public.objetivos_abrir_vigencia_alta();

-- El tipo fijo/móvil se conserva: es información que alguien cargó a mano y
-- que no se puede reconstruir. Si de verdad hay que borrarlo, va en la etapa B.

notify pgrst, 'reload schema';

commit;

-- ── ETAPA B · Destruir historial y tipo (opcional, irreversible) ────────────
-- Descomentar SÓLO si se decide que nada de esto debe conservarse.
--
-- begin;
--
-- drop policy if exists "Admin supervisor lee ubicaciones de objetivos de su alcance"
--   on public.objetivo_ubicaciones;
--
-- drop table if exists public.objetivo_ubicaciones;
--
-- alter table public.objetivos
--   drop constraint if exists objetivos_tipo_ubicacion_valido;
--
-- alter table public.objetivos
--   drop column if exists tipo_ubicacion;
--
-- -- btree_gist NO se desinstala: puede haberla instalado otra cosa, y quitarla
-- -- rompería cualquier otro EXCLUDE que dependa de ella.
--
-- notify pgrst, 'reload schema';
--
-- commit;
