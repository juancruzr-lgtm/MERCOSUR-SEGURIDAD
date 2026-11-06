-- Rollback de 20261208110000_postulaciones.sql
-- OJO: borra las postulaciones, su historial y el registro de archivos. Los
-- objetos del bucket `postulaciones` hay que borrarlos desde Storage antes
-- (el bucket no se elimina si tiene archivos). Los EMPLEADOS dados de alta
-- desde una postulación NO se tocan (ya son filas normales de usuarios).
-- Si hay cambios del legajo con origen 'solicitud_empleo', se conserva ese valor
-- en el check (no se puede quitar sin borrar historial).
begin;
drop function if exists public.postulacion_habilitar_supervisor(uuid, boolean);
drop function if exists public.postulacion_abrir_archivo(uuid);
drop function if exists public.postulacion_registrar_archivo(uuid, uuid, text, text, integer, text, smallint);
drop function if exists public.postulacion_alta_efectiva(uuid);
drop function if exists public.postulacion_descartar(uuid, text);
drop function if exists public.postulacion_aprobar(uuid, date, text);
drop function if exists public.postulacion_marcar_revisada(uuid);
drop function if exists public.postulacion_guardar(uuid, jsonb);
drop function if exists public.postulacion_crear(jsonb);
drop function if exists public.postulacion_duplicados(text, text, text, text, uuid);
drop table if exists public.postulacion_eventos;
drop table if exists public.postulacion_archivos;
drop function if exists public.postulacion_faltantes(public.postulaciones, text);
drop function if exists public.postulacion_para_editar(uuid);
drop function if exists public.postulacion_aplicar_datos(uuid, jsonb, uuid);
drop table if exists public.postulaciones;
drop table if exists public.postulaciones_habilitados;
drop function if exists public.postulacion_puede_ver(uuid);
drop function if exists public.postulacion_carga_habilitada();
drop function if exists public.postulacion_gestiona();
drop function if exists public.postulacion_actor();
drop function if exists public.postulacion_datos_seleccion_ok(jsonb);
drop function if exists public.postulacion_cuil_ok(text);
drop function if exists public.postulacion_inmutable();
delete from storage.buckets where id = 'postulaciones'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'postulaciones');
commit;
