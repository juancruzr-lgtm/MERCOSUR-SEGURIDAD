-- Rollback de 20261215100000_completar_legajo_vigilador.sql
-- Los datos y documentos que los vigiladores ya cargaron QUEDAN (están en el legajo).
begin;

do $do$
declare
  v_def text := pg_get_functiondef('public.documentacion_preparar(uuid,text,date,date,text,jsonb)'::regprocedure);
  v_nuevo text := '(p_tipo = ''credencial'' or (p_tipo = ''dni'' and coalesce((select h2.empleados from public.legajo_habilitacion h2 where h2.modulo = ''completar_legajo''), false))';
begin
  if position(v_nuevo in v_def) > 0 then
    execute replace(v_def, v_nuevo, '(p_tipo = ''credencial''');
  end if;
end
$do$;

drop function if exists public.mi_legajo_validar();
drop function if exists public.mi_legajo_posponer();
drop function if exists public.mi_legajo_pendiente();
drop function if exists public.legajo_campos_obligatorios_vigilador();
drop table if exists public.legajo_completar_estado;
delete from public.legajo_habilitacion where modulo = 'completar_legajo';

commit;
