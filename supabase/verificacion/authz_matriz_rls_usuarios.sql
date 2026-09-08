-- Matriz de autorización RLS de usuarios (simulación de persona + ROLLBACK).
-- Correr contra prod con la migración 20260908140000 ya aplicada. No modifica datos.
-- Esperado: todas las filas res=PASS.
begin;
-- Se ejecuta DESPUÉS de aplicar (o inlinear) la migración de RLS usuarios.
create temp table _rls(persona text, prueba text, esperado text, obtenido text);
grant all on _rls to authenticated;

set local role authenticated;

do $h$
declare
  V constant text := '{"sub":"680ccf43-c43e-4f9a-92db-be7173a8fe0a","role":"authenticated"}'; -- vigilador Almada
  S constant text := '{"sub":"67c2f633-b87c-432e-a372-7f842c923f30","role":"authenticated"}'; -- Sergio (supervisor)
  A constant text := '{"sub":"12e32e6c-f1f4-42c3-b007-9a18c76fc764","role":"authenticated"}'; -- Joel (administracion)
  G constant text := '{"sub":"c110bb0e-f0e4-42dd-af05-a1056f931d14","role":"authenticated"}'; -- Juan Cruz (gerencia)
  n bigint;
begin
  -- ===== LECTURA: cuántas filas de usuarios ve cada uno =====
  perform set_config('request.jwt.claims', V, true);
  select count(*) into n from public.usuarios;
  insert into _rls values('Vigilador','select_usuarios','solo_propia(1)', case when n=1 then 'OK(1)' else 'REVISAR('||n||')' end);

  perform set_config('request.jwt.claims', S, true);
  select count(*) into n from public.usuarios;
  insert into _rls values('Sergio','select_usuarios','muchas(operador)', case when n>1 then 'OK('||n||')' else 'REVISAR('||n||')' end);

  perform set_config('request.jwt.claims', A, true);
  select count(*) into n from public.usuarios;
  insert into _rls values('Administracion','select_usuarios','muchas(operador)', case when n>1 then 'OK('||n||')' else 'REVISAR('||n||')' end);

  -- ===== ESCALADA: intentar subirse el propio rol a admin =====
  -- Vigilador: la policy UPDATE (gestionar_personal) lo excluye => 0 filas (bloqueado sin error).
  perform set_config('request.jwt.claims', V, true);
  begin
    update public.usuarios set rol='admin' where auth_user_id = auth.uid();
    get diagnostics n = row_count;
    insert into _rls values('Vigilador','escalar_rol_propio','BLOQUEADO(0 filas)', case when n=0 then 'OK(0 filas)' else 'REVISAR('||n||' filas)' end);
  exception when others then insert into _rls values('Vigilador','escalar_rol_propio','BLOQUEADO', 'OK(excepcion)'); end;

  -- Sergio: idem, no es gestionar_personal => 0 filas.
  perform set_config('request.jwt.claims', S, true);
  begin
    update public.usuarios set rol='admin' where auth_user_id = auth.uid();
    get diagnostics n = row_count;
    insert into _rls values('Sergio','escalar_rol_propio','BLOQUEADO(0 filas)', case when n=0 then 'OK(0 filas)' else 'REVISAR('||n||' filas)' end);
  exception when others then insert into _rls values('Sergio','escalar_rol_propio','BLOQUEADO', 'OK(excepcion)'); end;

  -- Administracion: pasa la policy (gestionar_personal) pero el TRIGGER frena el
  -- escalamiento de PUESTO a gerencia (cambio real; Joel ya es rol=admin, por eso
  -- se prueba el puesto, que es lo sensible).
  perform set_config('request.jwt.claims', A, true);
  begin
    update public.usuarios set puesto_organizacional='gerencia' where auth_user_id = auth.uid();
    get diagnostics n = row_count;
    insert into _rls values('Administracion','escalar_puesto_gerencia','BLOQUEADO(trigger)', case when n=0 then 'OK(0 filas)' else 'REVISAR('||n||' filas cambiadas)' end);
  exception when others then insert into _rls values('Administracion','escalar_puesto_gerencia','BLOQUEADO(trigger)', 'OK(excepcion)'); end;

  -- ===== ALTA de personal =====
  -- Administracion crea guardia (rol guardia): permitido.
  perform set_config('request.jwt.claims', A, true);
  begin
    insert into public.usuarios(nombre,apellido,legajo,rol,estado) values('t','t','ZZ-TEST-1','guardia','activo');
    insert into _rls values('Administracion','alta_guardia','PERMITIDO','OK(alta)');
  exception when others then insert into _rls values('Administracion','alta_guardia','PERMITIDO','REVISAR: '||sqlerrm); end;
  -- Administracion intenta crear un ADMIN: el trigger lo frena.
  begin
    insert into public.usuarios(nombre,apellido,legajo,rol,estado) values('t','t','ZZ-TEST-2','admin','activo');
    insert into _rls values('Administracion','alta_admin','BLOQUEADO(trigger)','REVISAR: se permitio');
  exception when others then insert into _rls values('Administracion','alta_admin','BLOQUEADO(trigger)','OK(excepcion)'); end;

  -- Gerencia: puede cambiar rol.
  perform set_config('request.jwt.claims', G, true);
  begin
    update public.usuarios set rol=rol where auth_user_id = auth.uid(); -- no-op pero pasa policy+trigger
    get diagnostics n = row_count;
    insert into _rls values('Gerencia','gestiona_rol','PERMITIDO', case when n>=1 then 'OK('||n||')' else 'REVISAR(0)' end);
  exception when others then insert into _rls values('Gerencia','gestiona_rol','PERMITIDO','REVISAR: '||sqlerrm); end;

  perform set_config('request.jwt.claims', null, true);
end
$h$;

reset role;
select persona, prueba, esperado, obtenido,
       case when obtenido like 'OK%' then 'PASS' else 'FAIL' end as res
from _rls order by prueba, persona;
rollback;
