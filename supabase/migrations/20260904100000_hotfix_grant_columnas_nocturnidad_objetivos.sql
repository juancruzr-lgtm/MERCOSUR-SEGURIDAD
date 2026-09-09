-- ============================================================================
-- HOTFIX — GRANT de columnas de nocturnidad en objetivos
-- ============================================================================
--
-- Independiente de la serie F1 (M4..M10): corrige un bug que ya está en
-- producción desde el deploy de 20260903170000_nocturnidad_objetivo.sql.
--
-- MOTIVO
-- 20260815100000_objetivos_ubicacion_vigente.sql:384 revocó el UPDATE de
-- authenticated sobre objetivos y lo reconcedió POR COLUMNAS (9 columnas;
-- lat/lng/radio_metros quedan sólo por RPC). 20260903170000 agregó
-- nocturnidad_activa / nocturnidad_desde / nocturnidad_hasta pero NO extendió
-- ese GRANT. La pantalla de edición de objetivo del dashboard manda las tres
-- columnas en TODOS los guardados (app/dashboard/AppClient.tsx:3616-3618,
-- incondicional), así que cualquier edición de objetivo desde el navegador
-- falla hoy con "permission denied for column nocturnidad_activa" (42501).
-- No se manifestó aún porque nadie guardó un objetivo desde la UI después de
-- ese deploy — verificarlo editando cualquier objetivo antes de aplicar.
--
-- QUÉ HACE
-- Suma las tres columnas al GRANT por columnas existente (grant de columnas
-- es aditivo: las 9 de 20260815 no se tocan).
--
-- QUÉ NO TOCA
--   * lat / lng / radio_metros: siguen fuera del UPDATE directo (sólo RPC).
--   * Políticas RLS de objetivos (las reemplaza M6 de F1, que puede aplicarse
--     antes o después de este hotfix: son capas independientes).
--   * El trigger de auditoría (20260903170000 ya audita los tres campos).
--
-- ORDEN: aplicar apenas se verifique el bug; no depende de M4..M10 ni las
-- bloquea.
--
-- ANTES DE EJECUTAR: correr y guardar la sección PRE de
-- supabase/verificacion/20260904100000_hotfix_grant_columnas_nocturnidad_pre_post.sql
--
-- ROLLBACK: supabase/rollback/20260904100000_hotfix_grant_columnas_nocturnidad_rollback.sql
-- Idempotente: sí (un grant repetido no produce error).
-- ============================================================================

begin;

grant update (nocturnidad_activa, nocturnidad_desde, nocturnidad_hasta)
  on table public.objetivos to authenticated;

commit;

notify pgrst, 'reload schema';
