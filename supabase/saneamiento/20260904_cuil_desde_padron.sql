-- ============================================================================
-- SANEAMIENTO · CUIL faltantes desde el padrón oficial de personal
-- ============================================================================
-- Origen: "empleados.xls" — Planilla de Personal de MERCOSUR SEGURIDAD SRL,
-- fecha de emisión 04/09/2026, provista por Juan Cruz Romero.
-- Conciliación previa (04/09/2026): 74 empleados, CUILes todos válidos y
-- únicos, CERO contradicciones de CUIL contra la app.
--
-- QUÉ HACE: completa usuarios.cuil SOLO donde hoy es NULL, identificando a la
-- persona por su DNI — que en estos 13 casos está guardado en usuarios.legajo
-- (convención histórica del sistema). Son los 13 matches INEQUÍVOCOS de la
-- conciliación; los casos por-nombre y los ambiguos quedan afuera a propósito.
--
-- GARANTÍAS:
--   * cuil is null en el WHERE → jamás sobrescribe un CUIL existente.
--   * regexp sobre legajo → sólo matchea el DNI exacto.
--   * cada UPDATE toca a lo sumo 1 fila (DNI único en la app).
-- ============================================================================

begin;

update public.usuarios set cuil = '20373962997' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '37396299'; -- ALVAREZ, YAMIL EMANUEL
update public.usuarios set cuil = '27306711585' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '30671158'; -- BUSTAMANTE, DAMIAN ARIEL
update public.usuarios set cuil = '20420339616' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '42033961'; -- CENTURION, AGUSTIN EZEQUIEL
update public.usuarios set cuil = '20312511925' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '31251192'; -- FAIXAT, DAVID ANTONIO
update public.usuarios set cuil = '20331285359' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '33128535'; -- GOMEZ, JOSE MARIA
update public.usuarios set cuil = '20394555577' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '39455557'; -- GOMEZ, LUCAS EMANUEL
update public.usuarios set cuil = '23400389829' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '40038982'; -- MENA, BRIAN LUCIANO
update public.usuarios set cuil = '20441767871' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '44176787'; -- PANIAGUA, EDGAR IVAN
update public.usuarios set cuil = '20477655239' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '47765523'; -- PEREZ, SANTIAGO MATIAS
update public.usuarios set cuil = '20416925713' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '41692571'; -- RAMOS, JUAN BAUTISTA
update public.usuarios set cuil = '20283797555' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '28379755'; -- RODRIGUEZ, DIEGO FABIAN
update public.usuarios set cuil = '20295164507' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '29516450'; -- TABORDA, PABLO FEDERICO
update public.usuarios set cuil = '20446312996' where cuil is null and regexp_replace(coalesce(legajo,''), '\D', '', 'g') = '44631299'; -- VILLA, URIEL DANIEL

commit;

-- QUEDAN PENDIENTES (a propósito — sin clave dura para confirmar):
--   * JUAREZ JOEL, NARVARTE ANDREA, ROMERO JUAN CRUZ (admins, match sólo por
--     nombre; sus filas no tienen DNI en legajo).
--   * MAGARO LAURA NORA y ROMERO FACUNDO MARTIN (padrón sin correspondencia
--     comprobable; en el caso Facundo hay dos cuentas homónimas).
--   * GURUCHAR ADRIAN (match sólo por nombre; legajo G-026).
-- Ninguno es vigilador del Resumen Guardia de agosto.
