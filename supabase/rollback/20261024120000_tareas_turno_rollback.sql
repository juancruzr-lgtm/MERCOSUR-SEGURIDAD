-- Rollback de 20261024120000_tareas_turno.sql. Correr por separado.
-- ATENCIÓN: borra las tareas y lo que registraron los vigiladores. Si ya hay
-- registros reales, exportarlos antes. Las fotos quedan en el bucket y sus
-- filas en `evidencias` (proceso_tipo 'protocolo') se borran.

begin;

drop trigger if exists trg_tareas_turno_validar_evidencia on public.evidencias;
delete from public.evidencias where proceso_tipo = 'protocolo' and tipo_evidencia = 'tarea_turno';

-- Los controles que se activaron como tareas vuelven a «aprobado» (el
-- trigger de controles no deja tocar un activado: se suspende un momento).
alter table public.protocolo_controles_propuestos disable trigger trg_protocolo_control_proteger;
update public.protocolo_controles_propuestos
   set estado = 'aprobado', activado_por = null, activado_at = null, tarea_definicion_id = null
 where destino = 'tarea_turno' and estado = 'activado';
alter table public.protocolo_controles_propuestos enable trigger trg_protocolo_control_proteger;

alter table public.protocolo_controles_propuestos drop constraint if exists protocolo_control_activado_completo;
alter table public.protocolo_controles_propuestos drop column if exists tarea_definicion_id;
alter table public.protocolo_controles_propuestos add constraint protocolo_control_activado_completo check (
  estado <> 'activado' or (activado_por is not null and activado_at is not null
                           and destino = 'checklist_supervision'
                           and plantilla_id is not null and checklist_item_id is not null)
);

drop function if exists public.tareas_turno_panel(uuid, integer);
drop function if exists public.tareas_turno_ver_foto(uuid);
drop function if exists public.tareas_turno_destino_foto(uuid);
drop function if exists public.tareas_turno_registrar(uuid, uuid, text, text);
drop function if exists public.tareas_turno_mias();
drop function if exists public.tareas_turno_desactivar(uuid, text);
drop function if exists public.tareas_turno_activar(uuid, jsonb);

drop table if exists public.tareas_turno_registros;
drop table if exists public.tareas_turno_definiciones;

drop function if exists public.tareas_turno_validar_evidencia();
drop function if exists public.tareas_turno_def_proteger();

notify pgrst, 'reload schema';

commit;
