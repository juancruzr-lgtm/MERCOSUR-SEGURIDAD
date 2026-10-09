-- Rollback de 20261009140000_documentacion_legajo.
--
-- ATENCIÓN: sólo sirve ANTES de que haya documentos reales. Si ya se cargó
-- documentación, NO correr: se perdería el registro de constancias y accesos.
-- Los archivos del bucket `legajo-documentos` NO se borran acá (nada se borra
-- sin autorización expresa): el bucket queda, sin policies.
--
-- Las tablas tienen triggers que impiden borrar: se quitan las tablas enteras
-- con DROP (no DELETE), que no dispara triggers de fila.

begin;

drop policy if exists "Legajo documentos: subir ruta reservada" on storage.objects;

drop function if exists public.documentacion_control();
drop function if exists public.documentacion_de_empleado(uuid);
drop function if exists public.documentacion_marcar_situacion(uuid, text, text, text);
drop function if exists public.documentacion_anular(uuid, text);
drop function if exists public.documentacion_abrir(uuid, uuid, text, text, text);
drop function if exists public.documentacion_responder(uuid, text, text);
drop function if exists public.documentacion_revisar(uuid, text, text);
drop function if exists public.documentacion_confirmar(uuid);
drop function if exists public.documentacion_registrar_verificacion(uuid, text, text, integer);
drop function if exists public.documentacion_preparar(uuid, text, date, date, text, jsonb);

delete from public.legajo_habilitacion where modulo = 'documentacion';
drop table if exists public.documentacion_situaciones;
drop table if exists public.documentacion_accesos;
drop table if exists public.documentacion_constancias;
drop table if exists public.documentacion_eventos;
drop table if exists public.documentacion_verificaciones;
drop table if exists public.documentacion_archivos;
drop table if exists public.documentacion_documentos;
drop table if exists public.documentacion_tipos;

drop function if exists public.documentacion_reemplazar_anteriores(uuid, text[]);
drop function if exists public.documentacion_huella_repetida(text, uuid, uuid);
drop function if exists public.documentacion_huellas(uuid);
drop function if exists public.documentacion_registrar_evento(uuid, text, jsonb);
drop function if exists public.documentacion_cliente();
drop function if exists public.documentacion_usuario_actual();
drop function if exists public.documentacion_puede_subir_objeto(text);
drop function if exists public.documentacion_puede_ver(uuid, text, text);
drop function if exists public.documentacion_puede_gestionar();
drop function if exists public.documentacion_es_gerencia();
drop function if exists public.documentacion_documento_proteger();
drop function if exists public.documentacion_inmutable();

notify pgrst, 'reload schema';

commit;
