-- ============================================================================
-- BAJA DE WALTER FULLA — PROCEDIMIENTO PREPARADO. ***NO EJECUTAR*** sin la
-- autorización expresa de Gerencia (orden JC 08/10, punto 7).
--
-- Situación verificada el 08/10/2026 (sólo lectura):
--   usuario ACTIVO · rol/puesto supervisor · zona Rosario asignada ·
--   0 guardias futuras · 0 reglas · no está en escalamiento_destinatarios ·
--   0 suscripciones push · último aviso recibido 01/10.
--
-- QUÉ HACE: corta el acceso y las asignaciones. QUÉ NO HACE: no borra NADA —
-- intervenciones, guardias pasadas, envíos y auditoría quedan intactos (toda
-- referencia es por id y el usuario sólo cambia de estado).
-- Volver atrás: revertir cada UPDATE/INSERT con los valores que este mismo
-- script deja listados en el SELECT final (correrlo ANTES como foto).
-- ============================================================================

-- FOTO PREVIA (correr sola, guardar el resultado):
-- select u.id, u.estado, u.rol, u.puesto_organizacional,
--        (select count(*) from supervisor_zonas sz where sz.supervisor_id=u.id) as zonas,
--        (select count(*) from push_subscriptions ps where ps.usuario_id=u.id and ps.activo) as subs
-- from usuarios u where u.id = '<FULLA_ID>';

begin;

-- 1) Usuario inactivo: corta login por la app (el perfil queda, el historial queda).
update usuarios
   set estado = 'inactivo'
 where id = (select id from usuarios where apellido ilike 'fulla' and estado = 'activo' limit 1)
   and estado = 'activo';

-- 2) Quitar la asignación de zona: deja de ser candidato del resolver de
--    responsables (paso 2) y desaparece de los selectores operativos.
delete from supervisor_zonas
 where supervisor_id = (select id from usuarios where apellido ilike 'fulla' limit 1);
-- (supervisor_zonas es asignación de configuración, no historial: el vínculo
--  histórico real vive en supervisores_guardia, que NO se toca.)

-- 3) Suscripciones push a inactivo (hoy tiene 0; por si reaparece alguna):
update push_subscriptions set activo = false
 where usuario_id = (select id from usuarios where apellido ilike 'fulla' limit 1);

-- 4) Desactivar guardias FUTURAS si las hubiera al momento de ejecutar
--    (hoy: 0). Nunca borra; pasa a inactivo y queda auditado por el trigger
--    del PR #279 si ya está aplicado.
update supervisores_guardia set estado = 'inactivo'
 where supervisor_id = (select id from usuarios where apellido ilike 'fulla' limit 1)
   and fecha >= current_date and estado = 'activo';

commit;

-- VERIFICACIÓN POST (una sola sentencia):
-- select 'estado' as c, estado as v from usuarios where apellido ilike 'fulla'
-- union all select 'zonas', (select count(*)::text from supervisor_zonas sz join usuarios u on u.id=sz.supervisor_id where u.apellido ilike 'fulla')
-- union all select 'guardias_futuras_activas', (select count(*)::text from supervisores_guardia sg join usuarios u on u.id=sg.supervisor_id where u.apellido ilike 'fulla' and sg.fecha>=current_date and sg.estado='activo');
