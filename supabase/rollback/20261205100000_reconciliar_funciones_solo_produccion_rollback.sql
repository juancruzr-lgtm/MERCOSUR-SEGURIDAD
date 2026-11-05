-- Rollback de 20261205100000_reconciliar_funciones_solo_produccion.sql
--
-- NO-OP A PROPÓSITO.
-- La migración es una "foto": reescribe con `create or replace` el mismo texto
-- que ya corre en producción (verificado por md5 de prosrc) y sólo crea los
-- triggers si faltaban. Aplicada sobre producción no cambia nada, así que no
-- hay estado anterior que restaurar.
--
-- Lo que NO hay que hacer como "rollback":
--   * DROP de estas funciones: ia_es_admin / ia_es_operador sostienen
--     políticas RLS (ia_lotes, entrenamiento_operativo, evaluaciones_mensuales,
--     intervenciones_uso_app, observaciones_evaluacion, ia_configuraciones,
--     ia_referencia_imagenes), current_user_role la usan is_admin e
--     is_supervisor_or_admin, y las de trigger sostienen objetivos, turnos y
--     repositorio_documental.
--   * Volver turnos_completar_puesto a la versión de 20260728100000: usa
--     min(uuid), que no existe, y rompe todo INSERT en turnos sin puesto_id.
--
-- Este archivo sólo confirma el estado: si algo no está, lo informa.
select p.oid::regprocedure::text as funcion, md5(p.prosrc) as md5_prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('crear_puesto_principal_por_defecto', 'current_user_role',
                     'current_usuario_id', 'ia_es_admin', 'ia_es_operador',
                     'repdoc_upsert_atomico', 'set_actualizado_at',
                     'update_updated_at', 'turnos_completar_puesto')
 order by 1;
