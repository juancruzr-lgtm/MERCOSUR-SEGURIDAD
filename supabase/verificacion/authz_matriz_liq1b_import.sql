-- Matriz LIQ1B: importación de conceptos (simulación + ROLLBACK). Migración 20260908170000 aplicada.
-- Esperado: todas PASS (Gerencia importa; desconocido->catalogo; auditoria; dedupe; Administracion bloqueada).
begin;
create temp table _r(prueba text, esperado text, obtenido text);
grant all on _r to authenticated;
set local role authenticated;
do $h$
declare
  GER  constant text := '{"sub":"c110bb0e-f0e4-42dd-af05-a1056f931d14","role":"authenticated"}';
  ADM  constant text := '{"sub":"12e32e6c-f1f4-42c3-b007-9a18c76fc764","role":"authenticated"}';
  EMP  constant uuid := '69493cc2-15d6-4618-893e-4a9b1d044df8';
  per uuid; res jsonb; n int; nconc int; naud int;
  lineas jsonb;
begin
  perform set_config('request.jwt.claims', GER, true);
  per := public.crear_periodo_liquidacion('2099-09');
  lineas := jsonb_build_array(
    jsonb_build_object('empleado_id', EMP::text, 'concepto_id', null, 'codigo','888', 'nombre','concepto test', 'categoria','descuento', 'origen','importado', 'cantidad','1', 'importe','1234', 'permanente', false),
    jsonb_build_object('empleado_id', null, 'concepto_id', null, 'codigo','999', 'nombre','sin empleado', 'categoria','base_auxiliar', 'origen','importado', 'cantidad','1', 'importe','5', 'permanente', false)
  );
  -- Import 1 (gerencia)
  begin
    res := public.importar_conceptos_liquidacion(per, 'planilla.xlsx', 'HASH_TEST_0001', 'test', lineas);
    insert into _r values('gerencia_importa','altas>=1 error>=1', case when (res->>'altas')::int>=1 and (res->>'errores')::int>=1 then 'OK('||res::text||')' else 'REVISAR('||res::text||')' end);
  exception when others then insert into _r values('gerencia_importa','altas>=1','REVISAR: '||sqlerrm); end;
  -- Concepto desconocido incorporado al catálogo
  select count(*) into nconc from public.liquidacion_concepto_catalogo where codigo_visual='888';
  insert into _r values('crea_concepto_desconocido','1', case when nconc=1 then 'OK(1)' else 'REVISAR('||nconc||')' end);
  -- Concepto persistido en el período (empleado válido)
  select count(*) into n from public.liquidacion_concepto_periodo where periodo_id=per and empleado_id=EMP;
  insert into _r values('persiste_concepto_periodo','>=1', case when n>=1 then 'OK('||n||')' else 'REVISAR('||n||')' end);
  -- Auditoría escrita
  select count(*) into naud from public.liquidacion_auditoria where periodo_id=per;
  insert into _r values('auditoria_escrita','>=1', case when naud>=1 then 'OK('||naud||')' else 'REVISAR('||naud||')' end);
  -- Dedupe: mismo hash otra vez => excepción
  begin
    res := public.importar_conceptos_liquidacion(per, 'planilla.xlsx', 'HASH_TEST_0001', 'test', lineas);
    insert into _r values('dedupe_mismo_hash','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _r values('dedupe_mismo_hash','BLOQUEADO','OK(bloqueado)'); end;
  -- Administración no puede importar
  perform set_config('request.jwt.claims', ADM, true);
  begin
    res := public.importar_conceptos_liquidacion(per, 'otro.xlsx', 'HASH_TEST_0002', 'test', lineas);
    insert into _r values('administracion_importa','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _r values('administracion_importa','BLOQUEADO','OK(bloqueado)'); end;
  perform set_config('request.jwt.claims', null, true);
end $h$;
reset role;
select prueba, esperado, obtenido, case when obtenido like 'OK%' then 'PASS' else 'FAIL' end res from _r order by prueba;
rollback;
