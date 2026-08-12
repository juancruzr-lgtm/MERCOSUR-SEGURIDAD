-- ============================================================================
-- VERIFICACIÓN — Baja lógica del perfil duplicado de Nicolás González
-- DNI 44918748
-- ============================================================================
--
-- Acompaña a:
--   supabase/migrations/20260725_dedup_gonzalez_44918748.sql
--   supabase/rollback/20260725_dedup_gonzalez_44918748_rollback.sql
--
-- Perfil VÁLIDO     : b7fda919-8b52-4b8f-b82c-22580b6c8293
-- Perfil DUPLICADO  : 6b26c0d6-d5e1-45f0-bfda-c513f867b9d4
-- Cuenta Auth a desactivar : e2db3990-afab-48ac-a928-673b42a43a25
--
-- SOLO LECTURA. No contiene DDL ni DML.
-- Ejecutar por secciones.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — PRE-VERIFICACIÓN  (obligatoria antes del forward)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 ¿Existe alguna columna de texto libre en `usuarios` donde dejar la nota?
--     Si apareciera `observacion`, `nota`, `comentario` u similar, ESA es la
--     mejor sede de la trazabilidad y el forward debe usarla en lugar del
--     legajo. En el repositorio no existe ninguna; hay que confirmarlo en
--     producción, que tiene columnas no versionadas.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'usuarios'
 order by ordinal_position;


-- 1.2 Estado exacto de los dos perfiles.
--     Esperado: ambos `activo`, mismo DNI, mismo email, ambos con auth.
select id, legajo, apellido, nombre, dni, email, rol, estado,
       auth_user_id, created_at
  from public.usuarios
 where id in ('b7fda919-8b52-4b8f-b82c-22580b6c8293',
              '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4')
 order by created_at;


-- 1.3 Las dos cuentas de Auth.
--     Interesa sobre todo `email` del duplicado: si no contiene '@', es un
--     valor opaco y ese login no puede usarse con el email real, lo que hace
--     la desactivación todavía menos riesgosa.
select a.id as auth_id, a.email,
       (a.email !~ '@')                  as email_opaco,
       a.email_confirmed_at is not null   as confirmado,
       a.created_at, a.last_sign_in_at,
       a.last_sign_in_at is null          as nunca_ingreso
  from auth.users a
 where a.id in ('a71953e2-c64a-4f22-a810-c1eca9087857',
                'e2db3990-afab-48ac-a928-673b42a43a25')
 order by a.created_at;


-- 1.4 CONFIRMACIÓN DE QUE EL DUPLICADO SIGUE SIN HISTORIAL
--     Barrido dinámico de TODA FK que apunte a usuarios.id. No puede omitir
--     una tabla, incluidas las no versionadas.
--
--     ESPERADO: columna `duplicado` en 0 para TODAS las filas.
--     La auditoría del 2026-07-25 lo confirmó (0 turnos, 0 asistencias,
--     0 evidencias, 0 sesiones, 0 eventos, nunca inició sesión).
--
--     Si alguna fila trajera duplicado > 0, alguien le asignó datos en el
--     intervalo: el forward aborta por su propia guarda y NO hay que forzarlo.
with fks as (
  select distinct c.conrelid::regclass::text as tabla, a.attname::text as columna
    from pg_constraint c
    join unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.contype = 'f'
     and c.confrelid = 'public.usuarios'::regclass
     and c.connamespace = 'public'::regnamespace
)
select f.tabla, f.columna,
  (xpath('/row/c/text()', query_to_xml(
    format('select count(*) as c from %s where %I = %L', f.tabla, f.columna,
           'b7fda919-8b52-4b8f-b82c-22580b6c8293'), false, true, '')))[1]::text::bigint as valido,
  (xpath('/row/c/text()', query_to_xml(
    format('select count(*) as c from %s where %I = %L', f.tabla, f.columna,
           '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4'), false, true, '')))[1]::text::bigint as duplicado
from fks f
order by duplicado desc nulls last, f.tabla, f.columna;


-- 1.5 Telemetría: tablas que referencian usuarios.id SIN FK formal.
--     Muestra qué perfil se usó realmente en la aplicación.
select 'os_sessions' as tabla,
       (select count(*) from os_sessions where user_id = 'b7fda919-8b52-4b8f-b82c-22580b6c8293') as valido,
       (select count(*) from os_sessions where user_id = '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4') as duplicado
union all
select 'os_events',
       (select count(*) from os_events where user_id = 'b7fda919-8b52-4b8f-b82c-22580b6c8293'),
       (select count(*) from os_events where user_id = '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4');


-- 1.6 El legajo destino debe estar libre.
--     Esperado: 0 filas.
select id, legajo, estado from public.usuarios
 where legajo = 'DUP-44918748-20260725';


-- 1.7 ¿Hay un tercer perfil con el mismo DNI?
--     Esperado: 0 filas. Si aparece alguno, el forward NO debe ejecutarse
--     tal cual: hay que replantear el alcance.
select id, legajo, apellido, nombre, estado, auth_user_id
  from public.usuarios
 where dni = '44918748'
   and id not in ('b7fda919-8b52-4b8f-b82c-22580b6c8293',
                  '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4');


-- 1.8 ¿El patrón de legajo basura se repite en otros perfiles?
--     Si aparecen varios, hay una vía de carga que genera duplicados de forma
--     sistemática, y eso es más importante que este caso puntual.
select id, legajo, apellido, nombre, estado, created_at
  from public.usuarios
 where legajo ~ '^[^0-9A-Za-z]+$'
 order by created_at;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — POST-VERIFICACIÓN  (después del forward)
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Estado final de los dos perfiles.
--     Esperado:
--       b7fda919…  estado = 'activo'   legajo = '44918748'
--                  auth_user_id = 'a71953e2-c64a-4f22-a810-c1eca9087857'  (SIN CAMBIOS)
--       6b26c0d6…  estado = 'inactivo' legajo = 'DUP-44918748-20260725'
--                  auth_user_id = 'e2db3990-afab-48ac-a928-673b42a43a25'  (SIN CAMBIOS)
select id, legajo, apellido, nombre, estado, auth_user_id
  from public.usuarios
 where id in ('b7fda919-8b52-4b8f-b82c-22580b6c8293',
              '6b26c0d6-d5e1-45f0-bfda-c513f867b9d4')
 order by created_at;


-- 2.2 Un solo perfil ACTIVO para ese DNI. Esperado: 1.
select count(*) as activos_con_ese_dni
  from public.usuarios
 where dni = '44918748' and estado = 'activo';


-- 2.3 El historial NO se movió. Repetir 1.4 y comparar: los conteos de ambas
--     columnas deben ser IDÉNTICOS a los del pre — `duplicado` en 0 y `valido`
--     sin variación. Es la prueba de que el forward no tocó historial.


-- 2.4 La cuenta Auth del duplicado quedó desactivada.
--     Esperado: banned_until con fecha futura.
select id,
       (email !~ '@')            as email_opaco,
       banned_until,
       banned_until > now()      as bloqueada,
       last_sign_in_at
  from auth.users
 where id = 'e2db3990-afab-48ac-a928-673b42a43a25';


-- 2.5 La cuenta Auth del perfil válido sigue intacta y sin bloqueo.
--     Esperado: banned_until nulo o pasado.
select id, banned_until, last_sign_in_at
  from auth.users
 where id = 'a71953e2-c64a-4f22-a810-c1eca9087857';


-- 2.6 No se introdujeron duplicados de auth_user_id. Esperado: 0.
select count(*) as dup_auth_user_id
  from (select auth_user_id from public.usuarios
         where auth_user_id is not null
         group by 1 having count(*) > 1) x;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — Pruebas funcionales
-- ════════════════════════════════════════════════════════════════════════════
--
--  [ ] 1. El perfil válido inicia sesión con normalidad
--         (email gonzalesnicolas262@gmail.com, contraseña = DNI si nunca la
--         cambió; ver employee-auth.ts:135 `password: dni`).
--
--  [ ] 2. La cuenta desactivada NO puede iniciar sesión.
--         Sólo comprobable si su email es real; si es opaco, ya era
--         inutilizable con el email de la persona.
--
--  [ ] 3. Guardias: el duplicado desaparece del listado de activos y el
--         válido sigue apareciendo con legajo 44918748.
--
--  [ ] 4. Legajo digital del perfil válido (/guardias/b7fda919-…): carga y
--         muestra el historial esperado.
--
--  [ ] 5. Turnos y Asistencia: el válido sigue seleccionable; el duplicado ya
--         no aparece como guardia asignable.
--
--  [ ] 6. Reportes: exportar el mes en curso y comprobar que las horas
--         liquidables del válido NO cambiaron respecto del export previo.
--         Es la prueba de que no se tocó nada de liquidación.
--
--  Nota: no hay prueba de historial del duplicado porque no tiene ninguno.
--  Confirmado por la auditoría del 2026-07-25 y revalidado por la guarda del
--  forward en el momento de la ejecución.
-- ============================================================================
