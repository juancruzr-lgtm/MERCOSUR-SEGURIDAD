-- Ejecutar antes y después de la migración. Solo lectura.

select
  to_regclass('public.supervisor_intervenciones') as tabla,
  to_regprocedure('public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)') as rpc_fase0,
  to_regprocedure('public.registrar_cobertura(uuid,uuid,text,time,time,numeric,text)') as rpc_cobertura_dependencia,
  to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') as rpc_alcance_dependencia,
  to_regprocedure('public.rondas_usuario_actual_id()') as rpc_identidad_dependencia;

select to_regclass('public.turnos_auditoria') as turnos_auditoria_dependencia;

select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'turnos'
  and column_name = 'guardia_original_id';

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'supervisor_intervenciones'
  and column_name in ('operacion_id', 'reapertura_de_id', 'solicitud_json', 'resultado_json')
order by column_name;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'supervisor_intervenciones'
  and indexname in (
    'supervisor_intervenciones_operacion_id_uidx',
    'supervisor_intervenciones_ocurrencia_idx'
  )
order by indexname;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'supervisor_intervenciones'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'supervisor_intervenciones'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

with funcion as (
  select to_regprocedure(
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)'
  ) as oid
)
select
  case when oid is null then null else has_function_privilege('authenticated', oid, 'EXECUTE') end
    as authenticated_puede_ejecutar,
  case when oid is null then null else has_function_privilege('anon', oid, 'EXECUTE') end
    as anon_puede_ejecutar,
  case when oid is null then null else has_function_privilege('service_role', oid, 'EXECUTE') end
    as service_role_puede_ejecutar
from funcion;

select
  has_table_privilege('authenticated', 'public.supervisor_intervenciones', 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', 'public.supervisor_intervenciones', 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', 'public.supervisor_intervenciones', 'DELETE') as authenticated_delete,
  has_table_privilege('service_role', 'public.supervisor_intervenciones', 'SELECT') as service_role_select;

-- Control de duplicados: después debe devolver cero filas.
select to_jsonb(si)->>'operacion_id' as operacion_id, count(*) as cantidad
from public.supervisor_intervenciones si
where to_jsonb(si)->>'operacion_id' is not null
group by to_jsonb(si)->>'operacion_id'
having count(*) > 1;

-- Trazabilidad de reaperturas (muestra solo conteos, no modifica datos).
select
  count(*) filter (where si.accion = 'reapertura') as reaperturas,
  count(*) filter (
    where si.accion = 'reapertura'
      and to_jsonb(si)->>'reapertura_de_id' is null
  ) as reaperturas_sin_origen
from public.supervisor_intervenciones si;

-- Toda operación nueva debe conservar request y resultado para reintentos.
select count(*) as operaciones_sin_contrato_idempotente
from public.supervisor_intervenciones si
where to_jsonb(si)->>'operacion_id' is not null
  and (
    to_jsonb(si)->'solicitud_json' is null
    or to_jsonb(si)->'resultado_json' is null
  );
