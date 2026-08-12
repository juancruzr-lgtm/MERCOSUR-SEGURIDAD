-- ============================================================================
-- VERIFICACIÓN de M1 y M1-bis — antes, después y por rol
-- ============================================================================
--
-- Acompaña a:
--   supabase/migrations/20260725_m1_revoke_anon_tablas.sql
--   supabase/migrations/20260725_m1bis_default_privileges_anon.sql
--
-- TODO ESTE ARCHIVO ES DE SOLO LECTURA. No contiene DDL ni DML: sólo SELECT
-- sobre catálogos, y pruebas de rol encerradas en transacciones que terminan
-- siempre en ROLLBACK.
--
-- Ejecutar por secciones, no de corrido.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar M1 y M1-bis
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Superficie actual de `anon`: cuántas tablas y cuántos privilegios.
--     Esperado hoy: ~48 tablas, 7 privilegios cada una.
select count(distinct table_name) as tablas_con_acceso_anon,
       count(*)                   as privilegios_totales
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';


-- 1.2 Detalle por tabla, para el registro previo.
select table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegios
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon'
 group by table_name
 order by table_name;


-- 1.3 GENERADOR DEL ROLLBACK EXACTO  ← GUARDAR ESTA SALIDA
--     Produce las sentencias GRANT literales del estado previo. Es la fuente
--     autoritativa para revertir M1 (opción A del archivo de rollback).
--     Copiar el resultado completo a un archivo antes de aplicar M1.
select 'grant ' || privilege_type || ' on public.' || quote_ident(table_name)
       || ' to anon;' as sentencia_rollback
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon'
 order by table_name, privilege_type;


-- 1.4 Privilegios por defecto vigentes (los que M1-bis va a revocar).
select pg_get_userbyid(d.defaclrole) as propietario,
       case d.defaclobjtype when 'r' then 'tabla'
                            when 'S' then 'secuencia'
                            when 'f' then 'función'
                            else d.defaclobjtype::text end as objeto,
       d.defaclacl::text as acl
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public'
 order by propietario, objeto;


-- 1.5 CONTROL POSITIVO — confirma que la prueba de rol está bien construida.
--     `turnos` ya tiene RLS cerrada, así que `anon` debe devolver 0 filas
--     ANTES de M1. Si devolviera filas, la simulación de rol no funciona y el
--     resto de las pruebas darían falsos negativos.
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select 'turnos (debe ser 0 ya hoy)' as prueba, count(*) from turnos;
  select 'usuarios (debe ser > 0 hoy)' as prueba, count(*) from usuarios;
  select 'objetivos (debe ser 38 hoy)' as prueba, count(*) from objetivos;
rollback;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar M1 y M1-bis
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Superficie de `anon`. Esperado: 0 filas.
select table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';


-- 2.2 `authenticated` NO debe haber cambiado. Esperado: ~48 tablas.
select count(distinct table_name) as tablas_authenticated
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'authenticated';


-- 2.3 Privilegios por defecto. Esperado: 0 filas con `anon=` en public.
select pg_get_userbyid(d.defaclrole) as propietario,
       d.defaclobjtype, d.defaclacl::text as acl
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public'
   and d.defaclacl::text ilike '%anon=%';


-- 2.4 El esquema sigue siendo usable por PostgREST: `anon` conserva USAGE.
--     Esperado: true. Si diera false, los pedidos anónimos fallarían con un
--     error de esquema en lugar de un 401 limpio.
select has_schema_privilege('anon', 'public', 'USAGE') as anon_usage_public;


-- 2.5 Prueba de rol `anon`. Esperado: error de permiso en las tres.
--     Ejecutar de a una: la primera que falle aborta la transacción.
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) from usuarios;   -- esperado: permission denied
rollback;

begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) from objetivos;  -- esperado: permission denied
rollback;

begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) from push_subscriptions;  -- esperado: permission denied
rollback;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — Pruebas por rol autenticado (NADA debe cambiar)
-- ════════════════════════════════════════════════════════════════════════════
--
-- No hay nada que reemplazar: cada bloque resuelve por sí mismo el
-- `auth_user_id` de un usuario activo del rol correspondiente. El UID resuelto
-- se devuelve en la primera fila para que quede constancia de sobre quién se
-- probó.
--
-- El orden dentro de cada bloque importa: primero se calculan los claims
-- (todavía como postgres, con lectura libre de `usuarios`) y sólo después se
-- cambia de rol.
--
-- El resultado de cada bloque debe ser IDÉNTICO antes y después de M1.

-- 3.1 ADMIN
begin;
  select set_config('request.jwt.claims',
    json_build_object(
      'sub', (select auth_user_id::text from usuarios
               where rol = 'admin' and estado = 'activo'
                 and auth_user_id is not null
               order by created_at limit 1),
      'role', 'authenticated')::text, true) as claims_admin;
  select set_config('role', 'authenticated', true);
  select 'usuarios'      as tabla, count(*) from usuarios
  union all select 'objetivos',     count(*) from objetivos
  union all select 'turnos',        count(*) from turnos
  union all select 'registros',     count(*) from registros_asistencia
  union all select 'supervisiones', count(*) from supervisiones;
rollback;

-- 3.2 SUPERVISOR
begin;
  select set_config('request.jwt.claims',
    json_build_object(
      'sub', (select auth_user_id::text from usuarios
               where rol = 'supervisor' and estado = 'activo'
                 and auth_user_id is not null
               order by created_at limit 1),
      'role', 'authenticated')::text, true) as claims_supervisor;
  select set_config('role', 'authenticated', true);
  select 'usuarios'   as tabla, count(*) from usuarios
  union all select 'objetivos',  count(*) from objetivos
  union all select 'turnos',     count(*) from turnos
  union all select 'registros',  count(*) from registros_asistencia
  union all select 'evidencias', count(*) from evidencias
  union all select 'zonas',      count(*) from zonas_operativas;
rollback;

-- 3.3 VIGILADOR / GUARDIA
--     `objetivos` debe seguir devolviendo 38: de eso depende la geocerca del
--     fichaje (components/guardia/GuardiaMobile.tsx:574-576).
begin;
  select set_config('request.jwt.claims',
    json_build_object(
      'sub', (select auth_user_id::text from usuarios
               where rol in ('guardia','vigilador') and estado = 'activo'
                 and auth_user_id is not null
               order by created_at limit 1),
      'role', 'authenticated')::text, true) as claims_guardia;
  select set_config('role', 'authenticated', true);
  select 'objetivos (crítico: geocerca)' as tabla, count(*) from objetivos
  union all select 'turnos (sólo propios)',    count(*) from turnos
  union all select 'registros (sólo propios)', count(*) from registros_asistencia
  union all select 'evidencias (sólo propias)',count(*) from evidencias
  union all select 'app_config',               count(*) from app_config;
rollback;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 4 — Pruebas funcionales en la aplicación
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ejecutar en producción con usuarios reales, después de M1 + M1-bis.
-- Orden pensado para que un fallo aparezca lo antes posible.
--
--  [ ] 1. LOGIN
--         Iniciar sesión como admin, como supervisor y como vigilador.
--         Es la prueba que más importa: si algo del arranque necesitara `anon`,
--         falla acá.
--
--  [ ] 2. CARGA INICIAL DEL DASHBOARD
--         Panel de admin completo, y recarga de página con sesión ya iniciada
--         (ejercita AppClient.tsx:9336, la restauración de sesión).
--
--  [ ] 3. FICHAJE DEL VIGILADOR  ← el más crítico
--         Dar presente: obtener GPS, ver el objetivo y su radio, cargar las dos
--         fotos obligatorias, confirmar.
--         Verificar: fila nueva en `registros_asistencia`, fila nueva en
--         `evidencias`, objeto nuevo en el bucket `ingreso-evidencias`.
--         Verificar también que la distancia GPS se calcula, lo que prueba que
--         la lectura de `objetivos.lat/lng/radio_metros` sigue funcionando.
--
--  [ ] 4. EGRESO
--         Marcar salida y comprobar que queda registrada.
--
--  [ ] 5. PUSH — alta
--         Activar notificaciones en un dispositivo.
--         Verificar fila nueva o actualizada en `push_subscriptions`.
--         (Va por /api/push/subscribe con service_role; no debería verse
--         afectado, pero es barato comprobarlo.)
--
--  [ ] 6. PUSH — envío
--         Ejecutar el cron a mano con CRON_SECRET y comprobar que el JSON
--         devuelve contadores y que `notificaciones_enviadas` sigue creciendo.
--         Al 2026-07-25 hubo 105 notificaciones en 24 h, así que el control es
--         inmediato:
--           select max(created_at) from notificaciones_enviadas;
--
--  [ ] 7. SUPERVISIÓN
--         El supervisor abre un objetivo de su zona, completa el checklist con
--         foto obligatoria y guarda.
--         Verificar `supervisiones`, `supervision_respuestas`,
--         `supervision_fotos` y el objeto en el bucket `supervision-fotos`.
--
--  [ ] 8. ALERTAS
--         El supervisor resuelve una alerta con "Confirmar cubierto".
--         Verificar fila nueva en `supervisor_intervenciones` y que la alerta
--         desaparece de pendientes.
--
--  [ ] 9. TURNOS
--         Crear, editar y reasignar desde admin. Editar desde supervisor.
--         Verificar `turnos_auditoria`.
--
--  [ ] 10. REPORTES
--         Abrir Reportes, aplicar filtros y exportar XLSX.
--         Verificar que las horas liquidables no cambiaron.
--
-- CRITERIO DE ÉXITO: los diez pasos se comportan exactamente igual que antes
-- de la migración. M1 no debe producir ninguna diferencia observable para un
-- usuario con sesión iniciada.
--
-- SI ALGO FALLA: aplicar supabase/rollback/20260725_m1_rollback.sql (opción A
-- si se guardó la salida de 1.3), registrar el flujo y el error exacto, y no
-- reintentar hasta identificar el consumidor anónimo que la auditoría del
-- repositorio no detectó.
-- ============================================================================
