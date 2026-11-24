-- Rollback de 20261222110000_legajo_sin_revision_administracion.sql
-- Vuelve a pedir revisión de Administración para lo NUEVO que cargue el vigilador.
-- Lo que la migración ya aprobó queda aprobado (no se deshace: ya está en el legajo).
begin;

update public.legajo_campos
   set requiere_validacion = true
 where vigilador_propone
   and campo not like 'contacto_emergencia_%';

do $do$
declare
  v_def text := pg_get_functiondef('public.documentacion_confirmar(uuid)'::regprocedure);
  v_nuevo text := 'v_estado := case when v_doc.origen = ''vigilador'' and v_doc.tipo = ''dni'' then ''aprobado'' when v_doc.origen = ''vigilador'' or v_doc.tipo = ''credencial'' then';
  v_viejo text := 'v_estado := case when v_doc.origen = ''vigilador'' or v_doc.tipo = ''credencial'' then';
begin
  if position(v_nuevo in v_def) > 0 then
    execute replace(v_def, v_nuevo, v_viejo);
  end if;
end
$do$;

commit;
