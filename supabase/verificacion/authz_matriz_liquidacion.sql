-- Matriz de autorización LIQ1A (simulación + ROLLBACK). Migración 20260908160000 aplicada.
-- Esperado: todas PASS (sólo Gerencia crea/lee; Administración/Operaciones bloqueadas).
begin;
create temp table _liq(persona text, prueba text, esperado text, obtenido text);
grant all on _liq to authenticated;
set local role authenticated;
do $h$
declare
  GER  constant text := '{"sub":"c110bb0e-f0e4-42dd-af05-a1056f931d14","role":"authenticated"}'; -- gerencia
  ADM  constant text := '{"sub":"12e32e6c-f1f4-42c3-b007-9a18c76fc764","role":"authenticated"}'; -- administracion
  SERG constant text := '{"sub":"67c2f633-b87c-432e-a372-7f842c923f30","role":"authenticated"}'; -- supervisor
  DIR  constant text := '{"sub":"9285ec75-112f-44e6-8d3c-8ffc9f894a4b","role":"authenticated"}'; -- dir_op
  v uuid; n bigint;
begin
  perform set_config('request.jwt.claims', GER, true);
  begin v := public.crear_periodo_liquidacion('2099-01');
    insert into _liq values('Gerencia','crear_periodo','PERMITIDO', case when v is not null then 'OK(creado)' else 'REVISAR' end);
  exception when others then insert into _liq values('Gerencia','crear_periodo','PERMITIDO','REVISAR: '||sqlerrm); end;

  perform set_config('request.jwt.claims', ADM, true);
  begin v := public.crear_periodo_liquidacion('2099-02');
    insert into _liq values('Administracion','crear_periodo','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _liq values('Administracion','crear_periodo','BLOQUEADO','OK(bloqueado)'); end;

  perform set_config('request.jwt.claims', SERG, true);
  begin v := public.crear_periodo_liquidacion('2099-03');
    insert into _liq values('Sergio','crear_periodo','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _liq values('Sergio','crear_periodo','BLOQUEADO','OK(bloqueado)'); end;

  perform set_config('request.jwt.claims', DIR, true);
  begin v := public.crear_periodo_liquidacion('2099-04');
    insert into _liq values('DireccionOperativa','crear_periodo','BLOQUEADO','REVISAR: se permitio');
  exception when others then insert into _liq values('DireccionOperativa','crear_periodo','BLOQUEADO','OK(bloqueado)'); end;

  -- RLS lectura: gerencia ve periodos; administracion NO.
  perform set_config('request.jwt.claims', GER, true);
  select count(*) into n from public.liquidacion_periodo;
  insert into _liq values('Gerencia','select_periodo','ve(>=1)', case when n >= 1 then 'OK('||n||')' else 'REVISAR('||n||')' end);
  perform set_config('request.jwt.claims', ADM, true);
  select count(*) into n from public.liquidacion_periodo;
  insert into _liq values('Administracion','select_periodo','no_ve(0)', case when n = 0 then 'OK(0)' else 'REVISAR('||n||')' end);

  perform set_config('request.jwt.claims', null, true);
end $h$;
reset role;
select persona, prueba, esperado, obtenido, case when obtenido like 'OK%' then 'PASS' else 'FAIL' end as res from _liq order by prueba, persona;
rollback;
