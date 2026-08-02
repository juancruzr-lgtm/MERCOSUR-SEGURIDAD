-- Ejecutar antes y después de la migración correctiva. Solo lectura.

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'supervisor_intervenciones'
  and column_name = 'secuencia_evento';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'supervisor_intervenciones'
  and indexname = 'supervisor_intervenciones_secuencia_evento_uidx';

with funcion as (
  select pg_get_functiondef(to_regprocedure(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'
  )) as definicion
)
select
  regexp_count(definicion, 'order by si\.secuencia_evento desc') as ordenes_por_secuencia,
  regexp_count(definicion, 'order by si\.created_at desc, si\.id desc') as ordenes_heredados
from funcion;

do $$
declare
  v_nulos bigint;
  v_duplicados bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'supervisor_intervenciones'
      and column_name = 'secuencia_evento'
  ) then
    execute 'select count(*) from public.supervisor_intervenciones where secuencia_evento is null'
      into v_nulos;
    execute $sql$
      select count(*)
      from (
        select secuencia_evento
        from public.supervisor_intervenciones
        group by secuencia_evento
        having count(*) > 1
      ) duplicadas
    $sql$ into v_duplicados;
    if v_nulos <> 0 or v_duplicados <> 0 then
      raise exception 'Secuencia inválida: nulos %, duplicados %', v_nulos, v_duplicados;
    end if;
  else
    raise notice 'PRE: secuencia_evento todavía no existe';
  end if;
end;
$$;
