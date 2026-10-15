-- Rollback de 20261023120000_protocolo_controles_propuestos.sql
--
-- ATENCIÓN: borra instrucciones, controles propuestos y corridas de IA, y la
-- trazabilidad checklist_items.origen_instruccion_id. NO borra las plantillas
-- propias que se hayan creado al activar ni sus ítems: siguen asignadas a sus
-- objetivos y las supervisiones hechas con ellas quedan intactas. Para volver
-- un objetivo a la plantilla general, reasignarla desde Objetivos.
-- Los triggers de inmutabilidad no frenan DROP TABLE (sólo UPDATE/DELETE/TRUNCATE).

begin;

drop function if exists public.protocolo_controles_panel(uuid);
drop function if exists public.protocolo_controles_activar(uuid, uuid[]);
drop function if exists public.protocolo_control_rechazar(uuid, text);
drop function if exists public.protocolo_control_aprobar(uuid);
drop function if exists public.protocolo_control_editar(uuid, text, text, text, boolean);
drop function if exists public.protocolo_control_proponer(uuid, text, text, text, boolean);
drop function if exists public.protocolo_registrar_corrida_ia(uuid, text, integer, integer, jsonb, text);
drop function if exists public.protocolo_controles_contexto(uuid);
drop function if exists public.protocolo_instruccion_validar(uuid, text, text, text);
drop function if exists public.protocolo_instrucciones_segmentar(uuid);
drop function if exists public.protocolo_control_existente(uuid, text, uuid, text, uuid);
drop function if exists public.protocolo_version_para_preparar(uuid);

alter table public.checklist_items drop column if exists origen_instruccion_id;
alter table public.checklist_plantillas drop column if exists copiada_de_plantilla_id;
alter table public.checklist_plantillas drop column if exists objetivo_id;

drop table if exists public.protocolo_controles_propuestos;
drop table if exists public.protocolo_instrucciones;
drop table if exists public.protocolo_ia_corridas;

drop function if exists public.protocolo_control_proteger();
drop function if exists public.protocolo_instruccion_proteger();
drop function if exists public.protocolo_fragmento(text, integer, integer);
drop function if exists public.protocolo_normalizar(text);

notify pgrst, 'reload schema';

commit;
