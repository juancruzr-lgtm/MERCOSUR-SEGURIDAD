-- ============================================================================
-- Restaurar el ACCESO ADMIN PLENO de SERGIO MARTINEZ
-- id = 69493cc2-15d6-4618-893e-4a9b1d044df8 (rol='admin', auth 67c2f633-…)
-- ============================================================================
--
-- Contexto (JC 20/09): antes de la refactorización de permisos (ROLES), Sergio
-- operaba prácticamente toda la app porque su `rol='admin'` gobernaba todo. El
-- backfill de ROLES 1 (#171, migración 20260908110000) le seteó un PUESTO
-- (primero 'supervisor', luego pasó a 'jefe_supervisores' por dato). Desde
-- entonces `capacidadesDe()` (lib/capacidades.ts) usa el mapa del puesto y su
-- `rol='admin'` quedó INERTE — el fallback rol=admin sólo aplica con puesto NULL.
-- Resultado: perdió Configuración/Sistema, Novedades del Personal, Liquidación,
-- económico/gerencial y la gestión de personal general (a nivel UI y RLS).
--
-- FIX MÍNIMO Y FIEL AL ESTADO ANTERIOR: devolver su puesto a NULL. Con
-- puesto=null + rol='admin':
--   · lib/capacidades.ts → fallback admin = TODAS las capacidades (UI completa).
--   · RLS/RPC: es_gerencia_actual / puede_gestionar_personal_actual /
--     puede_liquidar_actual / es_operador_actual / alcance_operativo_de tienen
--     todas la rama (puesto null AND rol admin) → acceso pleno en la base.
--   · Las RPC operativas (crear_objetivo_operativo, dar_baja_objetivo_operativo,
--     autoservicio_/resolver_solicitud_personal_operativo) SIGUEN funcionando
--     (es_operador_actual y el OR con puede_gestionar_personal_actual pasan).
--
-- NO cambia `rol` (sigue 'admin'), NO toca su fila de supervisor_zonas (Rosario),
-- NO toca a ningún otro usuario, NO modifica el mapa de puestos ni ninguna RLS.
-- Es específico de Sergio: sólo su fila. Probado bajo su auth (before/after):
-- gerencia/gest_personal/liquidar pasan de false→true, operador se mantiene true.
--
-- OJO (confirmado con JC): esto le devuelve TAMBIÉN el acceso sensible
-- (económico, Liquidación y gestionar_usuarios_roles). Es lo pedido: "operar
-- prácticamente toda la aplicación como antes".
--
-- ROLLBACK: supabase/rollback/20260920120000_restaurar_admin_pleno_sergio_rollback.sql
-- Idempotente: sí.
-- ============================================================================

update public.usuarios
   set puesto_organizacional = null
 where id = '69493cc2-15d6-4618-893e-4a9b1d044df8'
   and lower(rol) = 'admin';
