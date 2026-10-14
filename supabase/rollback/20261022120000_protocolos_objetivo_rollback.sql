-- Rollback de 20261022120000_protocolos_objetivo.sql (y de la carga inicial
-- 20261022130000, que sólo inserta en estas tablas).
--
-- ATENCIÓN: borra las versiones, aperturas, confirmaciones y diferencias. Si
-- ya hay constancias de lectura reales, exportarlas antes: un rollback no
-- puede conservarlas. Correr por separado de la migración (nunca en el mismo
-- bloque).

begin;

drop function if exists public.protocolo_resumen_general();
drop function if exists public.protocolo_panel_objetivo(uuid);
drop function if exists public.protocolo_resolver_diferencia(uuid, text);
drop function if exists public.protocolo_asignar_responsable(uuid, text);
drop function if exists public.protocolo_registrar_diferencia(uuid, uuid, text, text, text, text, text);
drop function if exists public.protocolo_descartar(uuid, text);
drop function if exists public.protocolo_publicar(uuid);
drop function if exists public.protocolo_confirmar_asociacion(uuid, text);
drop function if exists public.protocolo_devolver_borrador(uuid, text);
drop function if exists public.protocolo_enviar_aprobacion(uuid);
drop function if exists public.protocolo_editar_borrador(uuid, text, text, text);
drop function if exists public.protocolo_crear_borrador(uuid, uuid, text, text, text, text, timestamptz, text);
drop function if exists public.protocolo_confirmar_lectura(uuid, uuid);
drop function if exists public.protocolo_registrar_apertura(uuid, uuid, timestamptz);
drop function if exists public.protocolo_mis_documentos();
drop function if exists public.protocolo_texto_declaracion();
drop function if exists public.protocolo_turno_para_version(uuid, uuid);
drop function if exists public.protocolo_turnos_habilitados();

drop table if exists public.protocolo_diferencias;
drop table if exists public.protocolo_confirmaciones;
drop table if exists public.protocolo_aperturas;
drop table if exists public.protocolo_versiones;

drop function if exists public.protocolo_puede_publicar();
drop function if exists public.protocolo_puede_preparar();
drop function if exists public.protocolo_puede_ver(uuid);
drop function if exists public.protocolo_diferencia_proteger();
drop function if exists public.protocolo_version_proteger();
drop function if exists public.protocolo_registro_inmutable();

notify pgrst, 'reload schema';

commit;
