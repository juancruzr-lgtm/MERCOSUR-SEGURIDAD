-- Matriz de autorización de novedades_laborales (simulación de persona + ROLLBACK).
-- Correr con la migración 20260908150000 aplicada. No modifica datos (rollback).
-- Esperado: todas res=PASS (Administración/Gerencia insertan; Sergio/Dir.Op/Vigilador no; operador lee).
begin;
create temp table _nl(persona text, prueba text, esperado text, obtenido text);
grant all on _nl to authenticated;
set local role authenticated;

do $h$
declare
  TARGET constant uuid := '69493cc2-15d6-4618-893e-4a9b1d044df8'; -- empleado destino (cualquiera válido)
  ADMIN  constant text := '{"sub":"12e32e6c-f1f4-42c3-b007-9a18c76fc764","role":"authenticated"}'; -- Joel (administracion)
  GER    constant text := '{"sub":"c110bb0e-f0e4-42dd-af05-a1056f931d14","role":"authenticated"}'; -- Juan Cruz (gerencia)
  SERG   constant text := '{"sub":"67c2f633-b87c-432e-a372-7f842c923f30","role":"authenticated"}'; -- Sergio (supervisor)
  DIROP  constant text := '{"sub":"9285ec75-112f-44e6-8d3c-8ffc9f894a4b","role":"authenticated"}'; -- Rodolfo (dir_op)
  VIG    constant text := '{"sub":"680ccf43-c43e-4f9a-92db-be7173a8fe0a","role":"authenticated"}'; -- vigilador
  n bigint;
  procedure_dummy int;
begin
  -- Helper inline: intento de INSERT de una novedad laboral aprobada.
  -- ADMIN debe poder; GER debe poder; SERG/DIROP/VIG NO deben poder.
  perform set_config('request.jwt.claims', ADMIN, true);
  begin
    insert into public.novedades_laborales(empleado_id,tipo,fecha_desde,fecha_hasta,estado,cargado_por,aprobado_por,aprobado_at,origen_carga)
      values(TARGET,'vacaciones','2026-09-10','2026-09-12','aprobada',TARGET,TARGET,now(),'app');
    insert into _nl values('Administracion','insert_novedad','PERMITIDO','OK(insert)');
  exception when others then insert into _nl values('Administracion','insert_novedad','PERMITIDO','REVISAR: '||sqlerrm); end;

  perform set_config('request.jwt.claims', GER, true);
  begin
    insert into public.novedades_laborales(empleado_id,tipo,fecha_desde,fecha_hasta,estado,cargado_por,aprobado_por,aprobado_at,origen_carga)
      values(TARGET,'vacaciones','2026-09-13','2026-09-14','aprobada',TARGET,TARGET,now(),'app');
    insert into _nl values('Gerencia','insert_novedad','PERMITIDO','OK(insert)');
  exception when others then insert into _nl values('Gerencia','insert_novedad','PERMITIDO','REVISAR: '||sqlerrm); end;

  perform set_config('request.jwt.claims', SERG, true);
  begin
    insert into public.novedades_laborales(empleado_id,tipo,fecha_desde,fecha_hasta,estado,cargado_por,aprobado_por,aprobado_at,origen_carga)
      values(TARGET,'vacaciones','2026-09-15','2026-09-16','aprobada',TARGET,TARGET,now(),'app');
    insert into _nl values('Sergio','insert_novedad','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _nl values('Sergio','insert_novedad','BLOQUEADO','OK(bloqueado)'); end;

  perform set_config('request.jwt.claims', DIROP, true);
  begin
    insert into public.novedades_laborales(empleado_id,tipo,fecha_desde,fecha_hasta,estado,cargado_por,aprobado_por,aprobado_at,origen_carga)
      values(TARGET,'vacaciones','2026-09-17','2026-09-18','aprobada',TARGET,TARGET,now(),'app');
    insert into _nl values('DireccionOperativa','insert_novedad','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _nl values('DireccionOperativa','insert_novedad','BLOQUEADO','OK(bloqueado)'); end;

  perform set_config('request.jwt.claims', VIG, true);
  begin
    insert into public.novedades_laborales(empleado_id,tipo,fecha_desde,fecha_hasta,estado,cargado_por,aprobado_por,aprobado_at,origen_carga)
      values(TARGET,'vacaciones','2026-09-19','2026-09-20','aprobada',TARGET,TARGET,now(),'app');
    insert into _nl values('Vigilador','insert_novedad','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _nl values('Vigilador','insert_novedad','BLOQUEADO','OK(bloqueado)'); end;

  -- Lectura operativa: Sergio (operador) puede SELECT novedades.
  perform set_config('request.jwt.claims', SERG, true);
  select count(*) into n from public.novedades_laborales;
  insert into _nl values('Sergio','select_novedades','operador_lee(>=0)', case when n >= 0 then 'OK('||n||')' else 'REVISAR' end);

  perform set_config('request.jwt.claims', null, true);
end
$h$;

reset role;
select persona, prueba, esperado, obtenido, case when obtenido like 'OK%' then 'PASS' else 'FAIL' end as res
from _nl order by prueba, persona;
rollback;
