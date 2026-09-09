-- ============================================================================
-- M1 — Revocar el acceso anónimo a las tablas del esquema public
-- ============================================================================
--
-- MOTIVO
-- Auditoría de producción del 2026-07-25: el rol `anon` tiene concedidos
-- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER sobre todas
-- las tablas de `public`. Como además existen políticas RLS `FOR ALL USING
-- (true)` sobre `usuarios`, `objetivos`, `novedades`, `supervisor_intervenciones`,
-- `push_subscriptions`, `notificaciones_enviadas`, `solicitudes_admin`,
-- `supervisores_guardia`, `servicios_objetivo`, `turnos_base`, `camaras`,
-- `alertas` y seis tablas no versionadas, el acceso es EFECTIVO en las dos
-- capas: cualquiera con la clave anónima publicada en el bundle del navegador
-- puede leer, modificar y borrar esos datos sin autenticarse.
--
-- Esta migración corta la capa GRANT. No toca ninguna política RLS.
--
-- POR QUÉ ES SEGURA
-- `anon` y `authenticated` son roles distintos: un usuario con sesión iniciada
-- opera como `authenticated`. La revisión del repositorio en f86a9cf2 no
-- encontró ninguna consulta a tablas de `public` con el rol `anon`:
--   * login / recuperación de sesión / reset de contraseña / magic link
--     usan la API de Auth (esquema `auth` vía GoTrue), no PostgREST
--     — app/dashboard/AppClient.tsx:624-627 y :9336-9340
--   * el alta de suscripción push va por /api/push/subscribe con service_role
--     — lib/push-client.ts:142
--   * la puerta de sesión monta todo recién con `user` presente
--     — app/dashboard/AppClient.tsx:9375
--   * no hay middleware, no hay Realtime, y el service worker no habla con
--     Supabase — public/sw.js
--
-- QUÉ NO TOCA
--   * `authenticated`  : conserva todos sus privilegios. Su contención es
--                        trabajo de RLS, no de GRANT.
--   * `service_role`   : intacto. Las 21 rutas /api/* dependen de él y hace
--                        bypass de RLS.
--   * USAGE sobre el esquema `public`: intacto. PostgREST lo necesita para
--                        introspección; sin privilegios de tabla, un pedido
--                        anónimo simplemente recibe 401/403.
--   * Políticas RLS    : ninguna. Se eliminan en M4..M10, por separado.
--   * Esquema `storage`: fuera de alcance, se decide aparte.
--
-- ALCANCE
-- Se usa la forma `ALL TABLES IN SCHEMA public` en lugar de una lista
-- explícita: una lista puede dejar afuera una tabla y ésa quedaría abierta.
-- Al 2026-07-25 el esquema contiene 48 tablas, incluidas 13 que no están
-- versionadas en este repositorio (`asignaciones`, `horarios_objetivo`,
-- `planillas_mensuales`, `planilla_detalle`, `reemplazos`, `servicios_base`,
-- `servicios_objetivo`, `repositorio_documental`, `usuarios` y las cinco
-- `backup_*_20260606`). Todas quedan cubiertas.
--
-- ANTES DE EJECUTAR
-- Correr la sección 1 de supabase/verificacion/20260725_m1_m1bis_pre_post.sql
-- y GUARDAR su salida: es la fuente autoritativa del rollback exacto.
--
-- ROLLBACK
-- supabase/rollback/20260725_m1_rollback.sql
--
-- Idempotente: revocar un privilegio ya revocado no produce error.
-- ============================================================================

begin;

-- ── Tablas ──────────────────────────────────────────────────────────────────
-- Cubre tablas, vistas y vistas materializadas del esquema.
revoke all privileges on all tables in schema public from anon;

-- ── Secuencias ──────────────────────────────────────────────────────────────
-- Todas las PK del sistema son uuid con gen_random_uuid(), de modo que no hay
-- dependencia funcional conocida de secuencias. Se revoca para que el estado
-- de `anon` quede uniforme y coherente con M1-bis, que también revoca el
-- privilegio por defecto sobre secuencias nuevas.
revoke all privileges on all sequences in schema public from anon;

commit;

-- ============================================================================
-- Verificación inmediata (debe devolver 0 filas)
-- ============================================================================
-- select table_name, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee = 'anon';
-- ============================================================================
