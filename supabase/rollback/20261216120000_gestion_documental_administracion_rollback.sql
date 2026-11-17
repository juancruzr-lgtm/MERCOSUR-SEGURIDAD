-- Rollback de 20261216120000_gestion_documental_administracion.
-- ATENCIÓN: borra los documentos, seguimientos, tareas, reclamos e informes
-- registrados con este módulo. Exportarlos antes si ya se usaron.
-- El bucket 'gestion-documentos' NO se borra (puede tener archivos).
begin;
drop function if exists public.gestion_informe_guardar(text, jsonb, text, text);
drop function if exists public.gestion_reclamo_registrar(date, text, text, uuid, uuid, text, uuid);
drop function if exists public.gestion_tarea_crear(text, text, date, uuid, text, text, uuid, uuid, text);
drop function if exists public.gestion_tarea_accion(uuid, uuid, text, integer, text, uuid);
drop function if exists public.gestion_seguimiento_accion(uuid, uuid, text, integer, uuid, date, text[], text);
drop function if exists public.gestion_documento_revisar(uuid, text, text);
drop function if exists public.gestion_documento_registrar(text, uuid, text, text, date, date, text, text, text, bigint, text, text, text, uuid, text);
drop table if exists public.gestion_recordatorios_config, public.gestion_informes_mensuales, public.gestion_reclamos,
  public.gestion_tarea_eventos, public.gestion_tareas_admin, public.gestion_seguimiento_eventos, public.gestion_seguimientos,
  public.gestion_documento_eventos, public.gestion_documentos, public.gestion_responsables, public.gestion_obligaciones,
  public.gestion_proveedores cascade;
drop function if exists public.gestion_documento_proteger();
drop function if exists public.gestion_bloquear_cambio();
drop function if exists public.gestion_bloquear_borrado();
drop function if exists public.gestion_es_gerencia();
drop function if exists public.gestion_admin_puede();
commit;
